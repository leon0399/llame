/**
 * Content search over the locators this process can walk (grep-tool spec).
 *
 * The runner admits every scope once against the `grep` group; this module
 * compiles the patterns, resolves each scope into an engine `GrepScope` with
 * per-file `read` admission, and pages the engine's passages.
 */

import {
  compileGrepPatterns,
  decodeGrepCursor,
  GREP_LIMITS,
  GREP_WARNING_KINDS,
  hashGrepInputs,
  measureGrepRendering,
  runGrepScan,
  type CompiledGrepPatterns,
  type DecodedGrepCursor,
  type GrepScanInput,
  type GrepScanResult,
  type GrepScope,
} from '@workspace/native-file-tools';
import { z } from 'zod';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  createGrepReadAdmission,
  grepScopeStrings,
  projectGrepScope,
  type GrepReadAdmission,
} from './grep-admission';
import {
  executeMachineScope,
  isMachineGrepScope,
  type CallBudget,
  type GrepSearchArguments,
  type MachineGrepScope,
} from './grep-machine';
import { namedUnfinished } from './grep-machine-wire';
import {
  addWarning,
  appendSegment,
  createPageState,
  pageIsFull,
  pageResult,
  remainingBudget,
  type SegmentPage,
} from './grep-page';
import { resolveScopes } from './grep-scopes';
import { type ResolvedScopes } from './grep-scope-shape';
import {
  GrepScopeFailure,
  invalidCursorResult,
  invalidInputResult,
  invalidPatternResult,
  type GrepToolError,
} from './grep-results';
import { type Tool, type ToolContext, type ToolResult } from './types';

export const grepInputSchema = z.strictObject({
  patterns: z.array(z.string().min(1).max(512)).min(1).max(8),
  scopes: z.array(z.string().min(1)).min(1).max(16).optional(),
  literal: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  cursor: z.string().optional(),
});

type GrepArguments = z.infer<typeof grepInputSchema>;

export const nativeGrepTool: Tool<GrepArguments> = {
  id: 'grep',
  classification: 'read_only',
  description: loadPackagedToolDescription('grep'),
  inputSchema: grepInputSchema,
  execute: (context, input) => executeGrep(context, input),
};

/** Whether a registry entry is this tool, by identity. */
export function isGrepTool(tool: Tool): boolean {
  return tool === nativeGrepTool;
}

async function executeGrep(
  context: ToolContext,
  input: GrepArguments,
): Promise<ToolResult> {
  context.abortSignal?.throwIfAborted();
  const root = context.workspaceRoot?.current();
  const submitted = grepScopeStrings(input, root);
  if (submitted === undefined) return scopesRequiredResult(context);
  const patterns = compileSubmittedPatterns(input);
  if ('status' in patterns) return patterns;

  const admission = createGrepReadAdmission(context);
  try {
    const resolved = await resolveScopes(context, submitted, admission);
    if ('result' in resolved) return resolved.result;

    return await scanPassages({
      context,
      input,
      patterns,
      admission,
      resolved,
      projectedScopes: submitted.map(
        (scope) => projectGrepScope(scope, root).prefix,
      ),
    });
  } finally {
    // A scope refusal can have counted files too, so the audit sees them on
    // every exit after resolution began, not only on a completed page.
    admission.recordRefusals();
  }
}

type ScanRequest = {
  readonly context: ToolContext;
  readonly input: GrepArguments;
  readonly patterns: CompiledGrepPatterns;
  readonly admission: GrepReadAdmission;
  readonly resolved: ResolvedScopes;
  readonly projectedScopes: ReadonlyArray<string>;
};

/** One ordered unit of work: local scopes the engine walks, or one Machine. */
type GrepSegment =
  | { readonly index: number; readonly scopes: ReadonlyArray<GrepScope> }
  | { readonly index: number; readonly machine: MachineGrepScope };

/** Page the call's scopes in submitted order; the caller records what policy hid. */
async function scanPassages(request: ScanRequest): Promise<ToolResult> {
  const { input, patterns, resolved } = request;
  const inputHash = hashOf(input, request.projectedScopes, resolved.roots);
  const cursor = resolveCursor(input.cursor, inputHash);
  if ('result' in cursor) return cursor.result;

  const budget = grepBudget(input.limit);
  const deadlineAt = Date.now() + budget.deadlineMs;
  const resume = cursor.cursor;
  const state = createPageState();
  for (const segment of segmentsOf(resolved)) {
    if (!state.complete) break;
    // The engine skips local scopes before the cursor itself; a Machine scope
    // is skipped here, before any request leaves for its box.
    if (
      resume !== undefined &&
      'machine' in segment &&
      segment.index < resume.scopeIndex
    )
      continue;
    const remaining = remainingBudget(budget, state, deadlineAt);
    // A full page continues on the next call; an expired deadline ends here.
    if (pageIsFull(state, budget) || remaining.deadlineMs <= 0) {
      if (remaining.deadlineMs <= 0) addWarning(state, 'deadline');
      state.complete = false;
      break;
    }
    const outcome = await runSegment({
      request,
      patterns,
      inputHash,
      segment,
      budget: remaining,
      cursor: resume,
      progressed: state.progressed,
    });
    if ('result' in outcome) return outcome.result;
    appendSegment(state, budget, outcome.page);
    if (!outcome.page.complete) state.complete = false;
  }
  return pageResult(state, inputHash);
}

/**
 * The submitted scopes in index order. Consecutive local scopes stay one
 * segment, so one engine call walks them; a Machine scope is its own segment.
 */
function segmentsOf(resolved: ResolvedScopes): ReadonlyArray<GrepSegment> {
  const ordered = [...resolved.scopes, ...(resolved.machines ?? [])].sort(
    (left, right) => left.index - right.index,
  );
  const segments: Array<GrepSegment> = [];
  let locals: Array<GrepScope> = [];
  for (const scope of ordered) {
    if (isMachineGrepScope(scope)) {
      if (locals.length > 0) {
        segments.push({ index: locals[0].index, scopes: locals });
        locals = [];
      }
      segments.push({ index: scope.index, machine: scope });
      continue;
    }
    locals.push(scope);
  }
  if (locals.length > 0)
    segments.push({ index: locals[0].index, scopes: locals });
  return segments;
}

type SegmentOutcome =
  | { readonly page: SegmentPage }
  | { readonly result: ToolResult };

/** What one segment is asked with, under the budget earlier segments left. */
type SegmentRun = {
  readonly request: ScanRequest;
  readonly patterns: CompiledGrepPatterns;
  readonly inputHash: string;
  readonly segment: GrepSegment;
  readonly budget: CallBudget;
  readonly cursor: DecodedGrepCursor | undefined;
  /** Whether the call already progressed in an earlier segment. */
  readonly progressed: boolean;
};

/** Run one segment: the engine walks local scopes, the Machine walks its own. */
async function runSegment(run: SegmentRun): Promise<SegmentOutcome> {
  return 'scopes' in run.segment
    ? runLocalSegment(run, run.segment.scopes)
    : runMachineSegment(run, run.segment.machine);
}

/** One Machine scope, sent as one `fs.grep` request through its connector. */
async function runMachineSegment(
  run: SegmentRun,
  scope: MachineGrepScope,
): Promise<SegmentOutcome> {
  const machine = await executeMachineScope({
    context: run.request.context,
    scope,
    args: searchArgumentsOf(run.request.input),
    budget: run.budget,
    resume:
      run.cursor !== undefined && run.cursor.scopeIndex === scope.index
        ? run.cursor
        : undefined,
    progressed: run.progressed,
    admission: run.request.admission,
  });
  if (machine.status === 'error') return { result: machine.result };
  const unfinished =
    machine.unfinished === undefined
      ? undefined
      : namedUnfinished(scope, machine.unfinished, run.request.admission);
  return {
    page: {
      entries: machine.entries,
      complete: machine.complete,
      warnings: machine.warnings,
      consumed: machine.consumed,
      progressed: machine.progressed,
      ...(unfinished !== undefined && { unfinished }),
      ...(machine.position !== undefined && {
        position: machine.position,
      }),
    },
  };
}

/** The local scopes of one run, walked by the shared engine under one budget. */
async function runLocalSegment(
  run: SegmentRun,
  scopes: ReadonlyArray<GrepScope>,
): Promise<SegmentOutcome> {
  const scanInput: GrepScanInput = {
    scopes,
    patterns: run.patterns,
    onCandidate: (locator) =>
      Promise.resolve(run.request.admission.admit(locator)),
    budget: run.budget,
    inputHash: run.inputHash,
    now: Date.now,
    progressed: run.progressed,
  };
  if (run.cursor !== undefined) scanInput.cursor = run.cursor;
  try {
    return { page: localPage(await runGrepScan(scanInput)) };
  } catch (error) {
    if (error instanceof GrepScopeFailure) return { result: error.result };
    throw error;
  }
}

/** The engine's own page, as the call's segment shape. */
function localPage(scan: GrepScanResult): SegmentPage {
  return {
    entries: scan.results.map((passage) => ({ passage })),
    complete: scan.complete,
    warnings: scan.warnings,
    consumed: scan.consumed,
    progressed: scan.progressed,
    ...(scan.unfinished !== undefined && { unfinished: scan.unfinished }),
    ...(scan.last !== undefined && { last: scan.last }),
    ...(scan.position !== undefined && { position: scan.position }),
  };
}

function searchArgumentsOf(input: GrepArguments): GrepSearchArguments {
  return {
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
  };
}

/** Compile the disjunction, or the refusal that names the offending index. */
function compileSubmittedPatterns(
  input: GrepArguments,
): CompiledGrepPatterns | GrepToolError {
  // Zod bounds the code units; the engine bound is UTF-8 bytes.
  const oversized = input.patterns.findIndex(
    (pattern) =>
      Buffer.byteLength(pattern, 'utf8') > GREP_LIMITS.maxPatternBytes,
  );
  if (oversized !== -1) {
    return invalidPatternResult(
      oversized,
      `pattern exceeds ${GREP_LIMITS.maxPatternBytes} UTF-8 bytes`,
    );
  }
  const compiled = compileGrepPatterns({
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
  });
  return compiled.ok
    ? compiled.compiled
    : invalidPatternResult(compiled.index, compiled.message);
}

type CursorOutcome =
  | { readonly cursor?: DecodedGrepCursor }
  | { readonly result: GrepToolError };

/** Decode the submitted cursor; only this call's own inputs can continue it. */
function resolveCursor(
  text: string | undefined,
  inputHash: string,
): CursorOutcome {
  if (text === undefined) return {};
  const decoded = decodeGrepCursor(text, inputHash);
  return 'error' in decoded
    ? { result: invalidCursorResult() }
    : { cursor: decoded };
}

function hashOf(
  input: GrepArguments,
  projectedScopes: ReadonlyArray<string>,
  resolvedRoots: ReadonlyArray<string>,
): string {
  return hashGrepInputs({
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
    projectedScopes,
    resolvedRoots,
  });
}

function grepBudget(limit: number | undefined): CallBudget {
  return {
    files: GREP_LIMITS.filesExamined,
    entries: GREP_LIMITS.entriesListed,
    bytes: GREP_LIMITS.bytesRead,
    // Files of any size are searched: the byte bound and the deadline stop a
    // file between its chunks, and an unfinished file is skipped by cursor.
    maxFileBytes: null,
    deadlineMs: GREP_LIMITS.deadlineMs,
    limit: limit ?? GREP_LIMITS.filesPerPage,
    pageUnits: GREP_LIMITS.pageCodeUnits,
    fixedReserve: pageFixedReserve(),
  };
}

/**
 * The rendered width of a page's own lines beside `results`: the Knowledge
 * notice and one `warnings` line naming every kind with a six-digit count, each
 * with its separating newline. The engine keeps exactly this much back from the
 * page's bound, and adds its own continuation line to that reservation.
 */
export function pageFixedReserve(): number {
  return (
    measureGrepRendering({
      results: [],
      complete: true,
      warnings: GREP_WARNING_KINDS.map((kind) => ({ kind, count: 999_999 })),
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }) + 2
  );
}

/**
 * The kinds this process can serve, and only those: no Space identifier, no
 * Machine name, and no host path may reach this message.
 */
function scopesRequiredResult(context: ToolContext): ToolResult {
  const kinds: Array<string> = [];
  if (context.nativeExecutorId !== undefined) kinds.push('host paths');
  if (context.machines !== undefined) kinds.push('machine:// locators');
  if (context.knowledgeResolver !== undefined) kinds.push('kb:// locators');
  if (context.skillCatalog !== undefined) kinds.push('skill:// locators');
  return invalidInputResult(
    kinds.length === 0
      ? 'grep requires scopes, and this process has no searchable backend.'
      : `grep requires scopes: this process can search ${joinKinds(kinds)}.`,
  );
}

function joinKinds(kinds: ReadonlyArray<string>): string {
  if (kinds.length === 1) return kinds[0];
  return `${kinds.slice(0, -1).join(', ')}, and ${kinds.at(-1)}`;
}
