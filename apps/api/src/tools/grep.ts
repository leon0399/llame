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
  hashGrepInputs,
  measureGrepRendering,
  runGrepScan,
  type CompiledGrepPatterns,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepScanInput,
  type GrepScanResult,
  type GrepScope,
} from '@workspace/native-file-tools';
import { z } from 'zod';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
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
  resumePointOf,
  type PageState,
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
  // The walk's deadline starts here, before scope resolution, so Knowledge
  // lookups, skill resolution, and host probes spend the walk's own time.
  const deadlineAt = Date.now() + grepWalkMs(context);
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
      deadlineAt,
    });
  } finally {
    // A scope refusal can have counted files too, so the audit sees them on
    // every exit after resolution began, not only on a completed page.
    admission.recordRefusals();
  }
}

/**
 * How long one call's walk may run: the call timeout minus the margin a
 * listing in progress or one over-long line test can add past the check. The
 * margin is the larger of 5 s and a tenth of the timeout, but at most half of
 * it, so a short call keeps half its time for the walk.
 */
function grepWalkMs(context: ToolContext): number {
  const timeoutMs =
    context.timeoutMs ??
    (context.callTimeoutSeconds ?? BUILT_IN_DEFAULTS.tools.callTimeoutSeconds) *
      1000;
  return timeoutMs - Math.min(timeoutMs / 2, Math.max(5000, timeoutMs / 10));
}

type ScanRequest = {
  readonly context: ToolContext;
  readonly input: GrepArguments;
  readonly patterns: CompiledGrepPatterns;
  readonly admission: GrepReadAdmission;
  readonly resolved: ResolvedScopes;
  readonly projectedScopes: ReadonlyArray<string>;
  /** The instant the walk stops, computed at `executeGrep` entry. */
  readonly deadlineAt: number;
};

/**
 * One ordered unit of work, in scope order: a host scope the engine walks, or
 * a Machine scope whose own `fs.grep` pages run on its box.
 */
type GrepSegment = GrepScope | MachineGrepScope;

/** Page the call's scopes in submitted order; the caller records what policy hid. */
async function scanPassages(request: ScanRequest): Promise<ToolResult> {
  const { input, patterns, resolved, deadlineAt } = request;
  const inputHash = hashOf(input, request.projectedScopes, resolved.roots);
  const cursor = resolveCursor(input.cursor, inputHash);
  if ('result' in cursor) return cursor.result;

  const budget = grepBudget(request.context, input.limit);
  const resume = cursor.cursor;
  const state = createPageState();
  const segments = segmentsOf(resolved);
  for (const segment of segments) {
    if (!state.complete) break;
    // A resumed call starts at the cursor's own segment: an earlier host scope
    // is never walked again, and a Machine scope is skipped before any request
    // leaves for its box.
    if (resume !== undefined && segment.index < resume.scopeIndex) continue;
    const remaining = remainingBudget(budget, state, deadlineAt);
    // A full page continues on the next call; an expired deadline ends here.
    if (pageIsFull(state, budget) || remaining.deadlineMs <= 0) {
      if (remaining.deadlineMs <= 0) endAtDeadline(state);
      else state.complete = false;
      resumeWithoutCursor(state, resume, segment.index);
      break;
    }
    const outcome = await runSegment({
      request,
      patterns,
      inputHash,
      segment,
      budget: remaining,
      // A cursor continues only the scope it names: an earlier one is skipped
      // above, and a later one starts at its own beginning.
      cursor: resume?.scopeIndex === segment.index ? resume : undefined,
      progressed: state.progressed,
    });
    if ('result' in outcome) return outcome.result;
    appendSegment(state, budget, outcome.page, request.admission);
    if (!outcome.page.complete) state.complete = false;
    resumeWithoutCursor(state, undefined, segment.index);
  }
  return pageResult(state, inputHash);
}

/**
 * Give an incomplete page a cursor when it stopped before taking any entry:
 * the incoming cursor as it was, or the segment's own start, so the next call
 * resumes instead of repeating the stop (the spec's stop-before-an-entry rule).
 */
function resumeWithoutCursor(
  state: PageState,
  incoming: DecodedGrepCursor | undefined,
  scopeIndex: number,
): void {
  if (state.complete || state.resume !== undefined) return;
  state.resume =
    incoming === undefined
      ? { kind: 'position', scopeIndex, rel: '' }
      : resumePointOf(incoming);
}

/**
 * End the page at the deadline. The hub reserved the deadline line's room
 * before any entry was admitted, so the stop the spec requires is always
 * reported, never deferred (design D7).
 */
function endAtDeadline(state: PageState): void {
  state.complete = false;
  addWarning(state, 'deadline');
}

/**
 * The submitted scopes in index order, one segment each: the engine walks one
 * host scope under the page budget the call has left, and a Machine scope runs
 * its own `fs.grep` pages (design D7).
 */
function segmentsOf(resolved: ResolvedScopes): ReadonlyArray<GrepSegment> {
  return [...resolved.scopes, ...(resolved.machines ?? [])].sort(
    (left, right) => left.index - right.index,
  );
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
  readonly budget: GrepBudget;
  /** The call's cursor, only when it names this segment's own scope. */
  readonly cursor: DecodedGrepCursor | undefined;
  /** Whether the call already progressed in an earlier segment. */
  readonly progressed: boolean;
};

/** Run one segment: the engine walks a host scope, the Machine walks its own. */
async function runSegment(run: SegmentRun): Promise<SegmentOutcome> {
  return isMachineGrepScope(run.segment)
    ? runMachineSegment(run, run.segment)
    : runLocalSegment(run, run.segment);
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
    resume: run.cursor,
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
      ...(machine.ignored !== undefined && { ignored: machine.ignored }),
      ...(machine.position !== undefined && {
        position: machine.position,
      }),
    },
  };
}

/**
 * One host scope, walked by the shared engine in one call under the page
 * budget the call has left (design D7).
 *
 * The engine still stops its page at `limit` files, because that page *is* the
 * model-facing page until the artifact holds the walk: `appendSegment` trusts
 * the engine's own page end as the resume point, so an engine page the hub
 * then cut at `limit` would resume past the matches it dropped. The artifact
 * layer drops both stops together, when the page becomes the head of the
 * artifact text.
 */
async function runLocalSegment(
  run: SegmentRun,
  scope: GrepScope,
): Promise<SegmentOutcome> {
  const scanInput: GrepScanInput = {
    scopes: [scope],
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
    ...(scan.ignored !== undefined && { ignored: scan.ignored }),
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

/**
 * What one call may walk with: the operator's `tools.grep` bounds (an unset
 * bound stays `null`), the page shape this process owns, and what is left of
 * the call deadline computed at `executeGrep` entry.
 */
function grepBudget(
  context: ToolContext,
  limit: number | undefined,
): GrepBudget {
  const bounds = context.grepBounds ?? BUILT_IN_DEFAULTS.tools.grep;
  return {
    files: bounds.maxFilesExamined,
    entries: bounds.maxEntriesListed,
    bytes: bounds.maxBytesRead,
    maxFileBytes: bounds.maxFileBytes,
    // Every segment derives its own remaining time from the call deadline.
    deadlineMs: 0,
    limit: limit ?? GREP_LIMITS.filesPerPage,
    pageUnits: GREP_LIMITS.pageCodeUnits,
    fixedReserve: pageFixedReserve(),
  };
}

/**
 * The rendered width of a page's own lines beside `results`: the Knowledge
 * notice line, its separating newline, and one spare newline. The engine keeps
 * exactly this much back from the page's bound and adds its own continuation
 * line; the `[warnings: …]` line and its newline are reserved separately as
 * counts arrive (design D7).
 */
export function pageFixedReserve(): number {
  return (
    measureGrepRendering({
      results: [],
      complete: true,
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
