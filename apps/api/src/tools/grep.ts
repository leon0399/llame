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
  encodeGrepCursor,
  GREP_LIMITS,
  GREP_WARNING_KINDS,
  hashGrepInputs,
  measureNativeModelOutput,
  runGrepScan,
  type CompiledGrepPatterns,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepPageEnd,
  type GrepPassage,
  type GrepScanInput,
  type GrepScanResult,
  type GrepScope,
  type GrepWarning,
  type GrepWarningKind,
} from '@workspace/native-file-tools';
import { z } from 'zod';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
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

/** One passage the call may emit, with the cursor point it ends at. */
type SegmentEntry = {
  readonly passage: GrepPassage;
  /** Absent for a walk whose own page end names the last passage. */
  readonly end?: GrepPageEnd;
};

/** What one segment contributes before the call's page is assembled. */
type SegmentPage = {
  readonly entries: ReadonlyArray<SegmentEntry>;
  readonly complete: boolean;
  readonly warnings: ReadonlyArray<GrepWarning>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** The walk's own page end, when every entry of the segment is a kept one. */
  readonly last?: GrepPageEnd;
};

/** Everything one call accumulates across its segments. */
type PageState = {
  readonly results: Array<GrepPassage>;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Files that contributed a passage, for the page's file bound. */
  readonly files: Set<string>;
  /** Code units the results array serializes to, brackets included. */
  units: number;
  complete: boolean;
  last: GrepPageEnd | undefined;
};

/** Page the call's scopes in submitted order; the caller records what policy hid. */
async function scanPassages(request: ScanRequest): Promise<ToolResult> {
  const { input, patterns, admission, resolved } = request;
  const inputHash = hashOf(input, request.projectedScopes, resolved.roots);
  const cursor = resolveCursor(input.cursor, inputHash);
  if ('result' in cursor) return cursor.result;

  const budget = grepBudget(input.limit);
  const deadlineAt = Date.now() + budget.deadlineMs;
  const state = createPageState();
  for (const segment of segmentsOf(resolved)) {
    if (!state.complete) break;
    // The engine skips local scopes before the cursor itself; a Machine scope
    // is skipped here, before any request leaves for its box.
    if (
      cursor.cursor !== undefined &&
      'machine' in segment &&
      segment.index < cursor.cursor.scopeIndex
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
      cursor: cursor.cursor,
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
  readonly budget: GrepBudget;
  readonly cursor: DecodedGrepCursor | undefined;
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
    admission: run.request.admission,
  });
  return machine.status === 'error'
    ? { result: machine.result }
    : {
        page: {
          entries: machine.entries,
          complete: machine.complete,
          warnings: machine.warnings,
          consumed: machine.consumed,
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
  const page: SegmentPage = {
    entries: scan.results.map((passage) => ({ passage })),
    complete: scan.complete,
    warnings: scan.warnings,
    consumed: scan.consumed,
  };
  return scan.last === undefined ? page : { ...page, last: scan.last };
}

function searchArgumentsOf(input: GrepArguments): GrepSearchArguments {
  return {
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
  };
}

function createPageState(): PageState {
  return {
    results: [],
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    files: new Set(),
    // An array of no element serializes as `[]`.
    units: 2,
    complete: true,
    last: undefined,
  };
}

/**
 * What is left of the call's bounds. The page's own brackets and a following
 * separator are subtracted, so the segment the values are handed to can never
 * emit past the call's page.
 */
function remainingBudget(
  budget: GrepBudget,
  state: PageState,
  deadlineAt: number,
): GrepBudget {
  const separator = state.results.length === 0 ? 0 : 1;
  return {
    files: Math.max(0, budget.files - state.consumed.files),
    entries: Math.max(0, budget.entries - state.consumed.entries),
    bytes: Math.max(0, budget.bytes - state.consumed.bytes),
    deadlineMs: Math.max(0, deadlineAt - Date.now()),
    limit: Math.max(0, budget.limit - state.files.size),
    pageUnits: Math.max(0, budget.pageUnits - state.units - separator),
    fixedReserve: budget.fixedReserve,
  };
}

function pageIsFull(state: PageState, budget: GrepBudget): boolean {
  return state.files.size >= budget.limit;
}

/** The locator without its line range, which is the file's identity. */
function fileOf(locator: string): string {
  return locator.slice(0, locator.lastIndexOf(':'));
}

/** Append one segment while the page holds it; the rest waits for a cursor. */
function appendSegment(
  state: PageState,
  budget: GrepBudget,
  page: SegmentPage,
): void {
  mergeWarnings(state, page.warnings);
  state.consumed.files += page.consumed.files;
  state.consumed.entries += page.consumed.entries;
  state.consumed.bytes += page.consumed.bytes;
  for (const entry of page.entries) {
    if (!fitsPage(state, budget, entry.passage)) {
      state.complete = false;
      return;
    }
    pushPassage(state, entry.passage);
    if (entry.end !== undefined) state.last = entry.end;
  }
  // A walk's own page end is trusted only when every passage it named was kept.
  if (page.last !== undefined) state.last = page.last;
}

function fitsPage(
  state: PageState,
  budget: GrepBudget,
  passage: GrepPassage,
): boolean {
  if (
    !state.files.has(fileOf(passage.locator)) &&
    state.files.size >= budget.limit
  )
    return false;
  const separator = state.results.length === 0 ? 0 : 1;
  return state.units + separator + passageUnits(passage) <= budget.pageUnits;
}

function pushPassage(state: PageState, passage: GrepPassage): void {
  const separator = state.results.length === 0 ? 0 : 1;
  state.results.push(passage);
  state.units += separator + passageUnits(passage);
  state.files.add(fileOf(passage.locator));
}

/** One passage's code units inside the results array, without its brackets. */
function passageUnits(passage: GrepPassage): number {
  return measureNativeModelOutput(passage) - 2;
}

function mergeWarnings(
  state: PageState,
  warnings: ReadonlyArray<GrepWarning>,
): void {
  for (const warning of warnings)
    addWarning(state, warning.kind, warning.count);
}

function addWarning(state: PageState, kind: GrepWarningKind, count = 1): void {
  state.warnings.set(kind, (state.warnings.get(kind) ?? 0) + count);
}

function pageResult(state: PageState, inputHash: string): ToolResult {
  const result: ToolResult = {
    status: 'success',
    results: state.results,
    complete: state.complete,
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    ...(carriesKnowledgePassage(state.results) && {
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }),
  };
  const last = state.last;
  if (state.complete || last === undefined) return result;
  return {
    ...result,
    cursor: encodeGrepCursor({
      scopeIndex: last.scopeIndex,
      rel: last.rel,
      startLine: last.startLine,
      ...(last.capped && { truncated: true as const }),
      inputHash,
    }),
  };
}

/**
 * Whether the page holds a Knowledge passage. Knowledge content is untrusted
 * in the same way a `kb://` read is, so the whole page carries the closed
 * notice, exactly as `read` and `knowledge_search` do.
 */
function carriesKnowledgePassage(results: GrepScanResult['results']): boolean {
  return results.some((passage) =>
    passage.locator.startsWith(`${KNOWLEDGE_LOCATOR_SCHEME}://`),
  );
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

function grepBudget(limit: number | undefined): GrepBudget {
  return {
    files: GREP_LIMITS.filesExamined,
    entries: GREP_LIMITS.entriesListed,
    bytes: GREP_LIMITS.bytesRead,
    deadlineMs: GREP_LIMITS.deadlineMs,
    limit: limit ?? GREP_LIMITS.filesPerPage,
    pageUnits: GREP_LIMITS.pageCodeUnits,
    fixedReserve: pageFixedReserve(),
  };
}

/**
 * The units a page's fields beside `results` may take: the status and
 * completeness envelope, one `warnings` entry for every kind with a six-digit
 * count, and the Knowledge notice. The engine keeps exactly this much back
 * from the page's bound, and adds its own cursor to that reservation.
 */
function pageFixedReserve(): number {
  return (
    measureNativeModelOutput({
      status: 'success',
      results: [],
      complete: false,
      warnings: GREP_WARNING_KINDS.map((kind) => ({ kind, count: 999_999 })),
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }) - 2
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
