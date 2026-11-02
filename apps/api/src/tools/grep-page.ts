/**
 * The call's page across its segments. Each segment — one run of local scopes
 * or one Machine — reports what it kept and what it consumed, and this module
 * appends it while the page holds it, so the bounds, the resume point, and the
 * 15,000-unit rendering never depend on which backend produced a passage.
 */

import {
  encodeGrepCursor,
  grepContinuationUnits,
  grepFileLocator,
  grepPassageUnits,
  grepWarningsUnits,
  measureGrepRendering,
  type GrepBudget,
  type GrepPageEnd,
  type GrepPassage,
  type GrepScanResult,
  type GrepWarning,
  type GrepWarningKind,
} from '@workspace/native-file-tools';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import { type ToolResult } from './types';

/** One passage the call may emit, with the cursor point it ends at. */
export type SegmentEntry = {
  readonly passage: GrepPassage;
  /** Absent for a walk whose own page end names the last passage. */
  readonly end?: GrepPageEnd;
};

/** What one segment contributes before the call's page is assembled. */
export type SegmentPage = {
  readonly entries: ReadonlyArray<SegmentEntry>;
  readonly complete: boolean;
  readonly warnings: ReadonlyArray<GrepWarning>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Whether the segment's walk got past the point the call started at. */
  readonly progressed: boolean;
  /** The file a bound stopped the segment inside before any progress. */
  readonly unfinished?: string;
  /** The walk's own page end, when every entry of the segment is a kept one. */
  readonly last?: GrepPageEnd;
  /** Where a segment that emitted nothing stopped, for a bound-stop cursor. */
  readonly position?: { readonly scopeIndex: number; readonly rel: string };
};

/** Where the call resumes: the last passage it emitted, or the last entry. */
type ResumePoint =
  | { readonly kind: 'passage'; readonly end: GrepPageEnd }
  | {
      readonly kind: 'position';
      readonly scopeIndex: number;
      readonly rel: string;
    };

/** Everything one call accumulates across its segments. */
export type PageState = {
  readonly results: Array<GrepPassage>;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Files that contributed a passage, for the page's file bound. */
  readonly files: Set<string>;
  /** Rendered width of `results`, kept as entries are appended. */
  units: number;
  complete: boolean;
  /** Whether the call got past the point it started at. */
  progressed: boolean;
  /** The file's locator a bound stopped the call inside before any progress. */
  unfinished: string | undefined;
  resume: ResumePoint | undefined;
};

export function createPageState(): PageState {
  return {
    results: [],
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    files: new Set(),
    units: 0,
    complete: true,
    progressed: false,
    unfinished: undefined,
    resume: undefined,
  };
}

/**
 * What is left of the call's bounds. The rendered text of the passages already
 * held and the newline that separates them from the next segment are
 * subtracted, so the segment the values are handed to can never emit past the
 * call's page. The whole page is measured exactly here, once per segment,
 * which also recalibrates the running total the segment's entries are admitted
 * against. The warnings line grows with the counts already merged, so the
 * reserve grows with it (design D7).
 */
export function remainingBudget(
  budget: GrepBudget,
  state: PageState,
  deadlineAt: number,
): GrepBudget {
  const separator = state.results.length === 0 ? 0 : 1;
  state.units = measureGrepRendering({
    results: state.results,
    complete: true,
  });
  return {
    files: remainingOf(budget.files, state.consumed.files),
    entries: remainingOf(budget.entries, state.consumed.entries),
    bytes: remainingOf(budget.bytes, state.consumed.bytes),
    maxFileBytes: budget.maxFileBytes,
    deadlineMs: Math.max(0, deadlineAt - Date.now()),
    limit: Math.max(0, budget.limit - state.files.size),
    pageUnits: Math.max(0, budget.pageUnits - state.units - separator),
    fixedReserve: budget.fixedReserve + warningsUnitsOf(state),
  };
}

/** What one bound has left; an unset (`null`) bound stays unset. */
export function remainingOf(bound: number | null, used: number): number | null {
  return bound === null ? null : Math.max(0, bound - used);
}

/** Rendered width of the `[warnings: …]` line the page would end with. */
function warningsUnitsOf(state: PageState): number {
  return grepWarningsUnits(
    [...state.warnings].map(([kind, count]) => ({ kind, count })),
  );
}

export function pageIsFull(state: PageState, budget: GrepBudget): boolean {
  return state.files.size >= budget.limit;
}

/** Append one segment while the page holds it; the rest waits for a cursor. */
export function appendSegment(
  state: PageState,
  budget: GrepBudget,
  page: SegmentPage,
): void {
  mergeWarnings(state, page.warnings);
  state.consumed.files += page.consumed.files;
  state.consumed.entries += page.consumed.entries;
  state.consumed.bytes += page.consumed.bytes;
  // Progress is the call's: a later segment's stop hides no file behind it.
  if (page.progressed) state.progressed = true;
  // A segment that names an unfinished file is incomplete, so the call stops
  // there: no later segment can overwrite it.
  state.unfinished = page.unfinished;
  for (const entry of page.entries) {
    if (!fitsPage(state, budget, entry)) {
      state.complete = false;
      return;
    }
    pushPassage(state, entry.passage);
    // A Machine entry names its own cursor point, so a page the call cuts
    // short still resumes from the last passage it kept.
    if (entry.end !== undefined)
      state.resume = { kind: 'passage', end: entry.end };
  }
  // A walk's own page end is trusted only when every passage it named was
  // kept: it is the furthest point the segment itself reached.
  if (page.last !== undefined)
    state.resume = { kind: 'passage', end: page.last };
  else if (page.position !== undefined && state.results.length === 0)
    // A page that emitted a passage carries a passage cursor; a position
    // cursor is the empty page's only way to resume.
    state.resume = { kind: 'position', ...page.position };
}

/**
 * Whether one more entry fits the page, measured on the text the model reads:
 * the passages the page holds, the widening this entry adds, the continuation
 * line that names the point the call would resume at, and the fields the
 * caller adds. A local entry was already fitted by the engine's own page, which
 * kept that continuation line and these fields back; a Machine entry names its
 * own resume point, so its line is reserved here at the placeholder cursor's
 * width.
 */
function fitsPage(
  state: PageState,
  budget: GrepBudget,
  entry: SegmentEntry,
): boolean {
  const file = grepFileLocator(entry.passage.locator);
  if (!state.files.has(file) && state.files.size >= budget.limit) return false;
  const end = entry.end;
  if (end === undefined) return true;
  return (
    state.units +
      grepPassageUnits(state.results.at(-1), entry.passage) +
      grepContinuationUnits({
        scopeIndex: end.scopeIndex,
        rel: end.rel,
        startLine: end.startLine,
        ...(end.endLine !== undefined && { endLine: end.endLine }),
        capped: end.capped,
      }) +
      budget.fixedReserve +
      warningsUnitsOf(state) <=
    budget.pageUnits
  );
}

function pushPassage(state: PageState, passage: GrepPassage): void {
  state.units += grepPassageUnits(state.results.at(-1), passage);
  state.results.push(passage);
  state.files.add(grepFileLocator(passage.locator));
}

function mergeWarnings(
  state: PageState,
  warnings: ReadonlyArray<GrepWarning>,
): void {
  for (const warning of warnings)
    addWarning(state, warning.kind, warning.count);
}

export function addWarning(
  state: PageState,
  kind: GrepWarningKind,
  count = 1,
): void {
  state.warnings.set(kind, (state.warnings.get(kind) ?? 0) + count);
}

export function pageResult(state: PageState, inputHash: string): ToolResult {
  const result: ToolResult = {
    status: 'success',
    results: state.results,
    complete: state.complete,
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    ...(state.unfinished !== undefined && {
      unfinishedFile: state.unfinished,
    }),
    ...(carriesKnowledgePassage(state.results) && {
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }),
  };
  const resume = state.resume;
  if (state.complete || resume === undefined) return result;
  return { ...result, cursor: resumeCursor(resume, inputHash) };
}

/**
 * The opaque cursor of one resume point: a position continues after the entry
 * a bound stopped at, a passage continues that passage — from the line after
 * the page's cut, when it cut one — and then in canonical order.
 */
function resumeCursor(resume: ResumePoint, inputHash: string): string {
  if (resume.kind === 'position')
    return encodeGrepCursor({
      kind: 'position',
      scopeIndex: resume.scopeIndex,
      rel: resume.rel,
      inputHash,
    });
  const end = resume.end;
  return encodeGrepCursor({
    scopeIndex: end.scopeIndex,
    rel: end.rel,
    startLine: end.startLine,
    ...(end.endLine !== undefined && { endLine: end.endLine }),
    ...(end.capped && { truncated: true as const }),
    inputHash,
  });
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
