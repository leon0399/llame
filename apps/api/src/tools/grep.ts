/**
 * Content search over the locators this process can walk (grep-tool spec).
 *
 * The runner admits every scope once against the `grep` group; this module
 * compiles the patterns, resolves each scope into an engine `GrepScope` with
 * per-file `read` admission, and walks every scope to its end, a bound, or the
 * deadline. The engine's pages and the daemon's pages continue inside the call.
 */

import {
  compileGrepPatterns,
  decodeGrepCursor,
  GREP_LIMITS,
  measureGrepRendering,
  runGrepScan,
  type CompiledGrepPatterns,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepScanInput,
  type GrepScanResult,
  type GrepScope,
  type GrepWarningKind,
} from '@workspace/native-file-tools';
import { z } from 'zod';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  createGrepReadAdmission,
  grepScopeStrings,
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
  budgetAfter,
  createPageState,
  pageResult,
  type PageState,
  type SegmentPage,
} from './grep-page';
import { resolveScopes } from './grep-scopes';
import { type ResolvedScopes } from './grep-scope-shape';
import {
  GrepScopeFailure,
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
  /** The instant the walk stops, computed at `executeGrep` entry. */
  readonly deadlineAt: number;
};

/**
 * One ordered unit of work, in scope order: a host scope the engine walks, or
 * a Machine scope whose own `fs.grep` pages run on its box.
 */
type GrepSegment = GrepScope | MachineGrepScope;

/** Walk the call's scopes in submitted order; the caller records what policy hid. */
async function scanPassages(request: ScanRequest): Promise<ToolResult> {
  const { patterns, resolved, deadlineAt } = request;
  const budget = grepBudget(request.context);
  const state = createPageState();
  for (const segment of segmentsOf(resolved)) {
    if (!state.complete) break;
    const remaining = budgetAfter(budget, state.consumed, deadlineAt);
    // An expired deadline ends the walk before another scope is opened.
    if (remaining.deadlineMs <= 0) {
      endAtDeadline(state);
      break;
    }
    const outcome = await runSegment({
      request,
      patterns,
      segment,
      budget: remaining,

      progressed: state.progressed,
    });
    if ('result' in outcome) return outcome.result;
    for (const page of outcome.pages)
      appendSegment(state, page, request.admission);
    // The last page of a segment carries its stop: a walked scope is complete
    // only when no bound or deadline ended it.
    if (outcome.pages.at(-1)?.complete !== true) state.complete = false;
  }
  return pageResult(state);
}

/** End the walk at the call deadline with the warning the spec requires. */
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
  | { readonly pages: ReadonlyArray<SegmentPage> }
  | { readonly result: ToolResult };

/** What one segment is asked with, under the budget earlier segments left. */
type SegmentRun = {
  readonly request: ScanRequest;
  readonly patterns: CompiledGrepPatterns;
  readonly segment: GrepSegment;
  readonly budget: GrepBudget;

  /** Whether the call already progressed in an earlier segment. */
  readonly progressed: boolean;
};

/** Run one segment: the engine walks a host scope, the Machine walks its own. */
async function runSegment(run: SegmentRun): Promise<SegmentOutcome> {
  return isMachineGrepScope(run.segment)
    ? runMachineSegment(run, run.segment)
    : runLocalSegment(run, run.segment);
}

/** One Machine scope, which pages over `fs.grep` on its own box. */
async function runMachineSegment(
  run: SegmentRun,
  scope: MachineGrepScope,
): Promise<SegmentOutcome> {
  const machine = await executeMachineScope({
    context: run.request.context,
    scope,
    args: searchArgumentsOf(run.request.input),
    budget: run.budget,

    progressed: run.progressed,
    admission: run.request.admission,
  });
  if (machine.status === 'error') return { result: machine.result };
  const unfinished =
    machine.unfinished === undefined
      ? undefined
      : namedUnfinished(scope, machine.unfinished, run.request.admission);
  return {
    pages: [
      {
        results: machine.passages,
        complete: machine.complete,
        warnings: machine.warnings,
        consumed: machine.consumed,
        progressed: machine.progressed,
        unfinished,
        ignored: machine.ignored,
      },
    ],
  };
}

/**
 * The one hash a call binds its internal engine cursors to. No cursor leaves
 * the call, so a fixed value is all the codec needs.
 */
const INTERNAL_CURSOR_HASH = 'grep-walk';

/**
 * The host engine page is internal and never reaches the model, so it holds
 * ten times the old 20-file model page: a broad walk resumes rarely, and a cut
 * page reports its counts as of its last kept passage.
 */
const HOST_PAGE_FILES = GREP_LIMITS.filesPerPage * 10;
const HOST_PAGE_UNITS = GREP_LIMITS.pageCodeUnits * 4;

/** The bound or deadline that ended an engine page, when one did. */
const PAGE_STOP_KINDS: ReadonlySet<GrepWarningKind> = new Set([
  'file_bound',
  'entry_bound',
  'byte_bound',
  'deadline',
]);

/**
 * One host scope, walked by the shared engine over as many pages as its own
 * page bound asks for (design D7). A page the engine cut at its own bound and
 * a page a bound or the deadline ended both report an incomplete page; only
 * the latter stops the walk. Every page resumes from the engine's cursor, so a
 * walk never opens a file twice.
 */
async function runLocalSegment(
  run: SegmentRun,
  scope: GrepScope,
): Promise<SegmentOutcome> {
  const pages: Array<SegmentPage> = [];
  let walk: PageWalk = {
    cursor: undefined,
    progressed: run.progressed,
    budget: {
      ...run.budget,
      limit: HOST_PAGE_FILES,
      pageUnits: HOST_PAGE_UNITS,
    },
  };
  try {
    for (;;) {
      const scan = await runGrepScan(engineInput(run, scope, walk));
      pages.push(localPage(scan));
      const next = nextPage(scan, walk, run.request.deadlineAt);
      if (next === undefined) break;
      walk = next;
    }
    return { pages };
  } catch (error) {
    if (error instanceof GrepScopeFailure) return { result: error.result };
    throw error;
  }
}

/** How the host engine's next internal page resumes. */
type PageWalk = {
  readonly cursor: DecodedGrepCursor | undefined;
  readonly progressed: boolean;
  readonly budget: GrepBudget;
};

/** One host engine call, resumed from the call's own previous page. */
function engineInput(
  run: SegmentRun,
  scope: GrepScope,
  walk: PageWalk,
): GrepScanInput {
  return {
    scopes: [scope],
    patterns: run.patterns,
    onCandidate: (locator) =>
      Promise.resolve(run.request.admission.admit(locator)),
    budget: walk.budget,
    cursor: walk.cursor,
    inputHash: INTERNAL_CURSOR_HASH,
    now: Date.now,
    progressed: walk.progressed,
  };
}

/** The next internal page's state, or undefined when the walk ends here. */
function nextPage(
  scan: GrepScanResult,
  walk: PageWalk,
  deadlineAt: number,
): PageWalk | undefined {
  if (scan.complete || scan.cursor === undefined) return undefined;
  if (scan.warnings.some((warning) => PAGE_STOP_KINDS.has(warning.kind)))
    return undefined;
  const cursor = decodeGrepCursor(scan.cursor, INTERNAL_CURSOR_HASH);
  if ('error' in cursor) return undefined;
  return {
    cursor,
    progressed: walk.progressed || scan.progressed,
    budget: budgetAfter(walk.budget, scan.consumed, deadlineAt),
  };
}

/** The engine's own page, as the call's segment shape. */
function localPage(scan: GrepScanResult): SegmentPage {
  return {
    results: scan.results,
    complete: scan.complete,
    warnings: scan.warnings,
    consumed: scan.consumed,
    progressed: scan.progressed,
    ...(scan.unfinished !== undefined && { unfinished: scan.unfinished }),
    ...(scan.ignored !== undefined && { ignored: scan.ignored }),
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

/**
 * What one call may walk with: the operator's `tools.grep` bounds (an unset
 * bound stays `null`) and one internal page of the engine or the daemon. Every
 * segment derives its own remaining time from the call deadline.
 */
function grepBudget(context: ToolContext): GrepBudget {
  const bounds = context.grepBounds ?? BUILT_IN_DEFAULTS.tools.grep;
  return {
    files: bounds.maxFilesExamined,
    entries: bounds.maxEntriesListed,
    bytes: bounds.maxBytesRead,
    maxFileBytes: bounds.maxFileBytes,
    deadlineMs: 0,
    limit: GREP_LIMITS.filesPerPage,
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
