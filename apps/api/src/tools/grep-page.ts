/**
 * The call's results across its segments. Each segment — one host scope or one
 * Machine — reports what it kept and what it consumed, and this module appends
 * it, so the bounds, the counts, and the order never depend on which backend
 * produced a passage. The engine's pages are internal to a walk: a passage it
 * cut at its own page bound and the passage that continues it are one passage
 * of the result.
 */

import {
  GREP_LIMITS,
  grepFileLocator,
  passageEndLine,
  passageStartLine,
  spellGrepHostScopeLocator,
  spellGrepMachineScopeLocator,
  type GrepBudget,
  type GrepIgnored,
  type GrepPassage,
  type GrepWarning,
  type GrepWarningKind,
} from '@workspace/native-file-tools';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import { type GrepReadAdmission } from './grep-admission';
import { type ToolResult } from './types';

/** A reported exclusion in the spelling its scheme's scope uses. */
function spellIgnoredLocator(locator: string): string {
  return locator.startsWith('machine://')
    ? spellGrepMachineScopeLocator(locator)
    : spellGrepHostScopeLocator(locator);
}

/** What one segment contributes before the call's result is assembled. */
export type SegmentPage = {
  readonly results: ReadonlyArray<GrepPassage>;
  readonly complete: boolean;
  readonly warnings: ReadonlyArray<GrepWarning>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Whether the segment's walk got past the point the call started at. */
  readonly progressed: boolean;
  /** The file a bound stopped the segment inside before any progress. */
  readonly unfinished?: string;
  /** The excluded directories of the segment, before the `read` filter. */
  readonly ignored?: GrepIgnored;
};

/** Everything one call accumulates across its segments. */
export type PageState = {
  readonly results: Array<GrepPassage>;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Whether the walk reached the end of the last scope. */
  complete: boolean;
  /** Whether the call got past the point it started at. */
  progressed: boolean;
  /** The file's locator a bound stopped the call inside before any progress. */
  unfinished: string | undefined;
  /** The excluded directories the `read` group admitted, in canonical order. */
  ignored: {
    readonly paths: Array<string>;
    /** Every locator already counted, so two pages count a directory once. */
    readonly seen: Set<string>;
    count: number;
    atLeast: boolean;
  };
};

export function createPageState(): PageState {
  return {
    results: [],
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    complete: true,
    progressed: false,
    unfinished: undefined,
    ignored: { paths: [], seen: new Set(), count: 0, atLeast: false },
  };
}

/**
 * What is left of the call's bounds after one walk consumed its share, with
 * the deadline refreshed. The page shape stays the backend's own: the engine
 * and the daemon both cut their pages internally.
 */
export function budgetAfter(
  budget: GrepBudget,
  consumed: { files: number; entries: number; bytes: number },
  deadlineAt: number,
): GrepBudget {
  return {
    ...budget,
    files: remainingOf(budget.files, consumed.files),
    entries: remainingOf(budget.entries, consumed.entries),
    bytes: remainingOf(budget.bytes, consumed.bytes),
    deadlineMs: Math.max(0, deadlineAt - Date.now()),
  };
}

/** What one bound has left; an unset (`null`) bound stays unset. */
function remainingOf(bound: number | null, used: number): number | null {
  return bound === null ? null : Math.max(0, bound - used);
}

/** Append one segment in result order; the caller records the stop. */
export function appendSegment(
  state: PageState,
  page: SegmentPage,
  admission: GrepReadAdmission,
): void {
  mergeIgnored(state, page.ignored, admission);
  mergeWarnings(state, page.warnings);
  state.consumed.files += page.consumed.files;
  state.consumed.entries += page.consumed.entries;
  state.consumed.bytes += page.consumed.bytes;
  // Progress is the call's: a later segment's stop hides no file behind it.
  if (page.progressed) state.progressed = true;
  // A segment that names an unfinished file is incomplete, so the call stops
  // there: no later segment can overwrite it.
  state.unfinished = page.unfinished;
  for (const passage of page.results) pushPassage(state, passage);
}

/** One passage, joined to the passage its internal page bound cut before it. */
function pushPassage(state: PageState, passage: GrepPassage): void {
  const previous = state.results.at(-1);
  const merged =
    previous === undefined ? undefined : mergeCutPassage(previous, passage);
  if (merged === undefined) state.results.push(passage);
  else state.results[state.results.length - 1] = merged;
}

/**
 * The passage a page bound cut and the passage that continues it, as one
 * passage. The walk never stopped, so the model reads the whole window and an
 * internal page boundary leaves no mark on the result.
 */
function mergeCutPassage(
  previous: GrepPassage,
  next: GrepPassage,
): GrepPassage | undefined {
  if (previous.cut !== true) return undefined;
  const file = grepFileLocator(previous.locator);
  if (grepFileLocator(next.locator) !== file) return undefined;
  if (passageEndLine(previous.locator) + 1 !== passageStartLine(next.locator))
    return undefined;
  const matches = [...new Set([...previous.matches, ...next.matches])].sort(
    (left, right) => left - right,
  );
  const truncated = previous.truncated === true || next.truncated === true;
  return {
    locator: `${file}:${String(passageStartLine(previous.locator))}-${String(
      passageEndLine(next.locator),
    )}`,
    content: `${previous.content}\n${next.content}`,
    matches,
    ...(next.cut === true && { cut: true as const }),
    ...(truncated && { truncated: true as const }),
  };
}

/**
 * Take one segment's excluded directories, up to the call's cap, judge each
 * against the `read` group as written and with a final separator, and keep the
 * first five admitted locators as raw paths.
 */
function mergeIgnored(
  state: PageState,
  ignored: SegmentPage['ignored'],
  admission: GrepReadAdmission,
): void {
  if (ignored === undefined) return;
  if (ignored.atLeast) state.ignored.atLeast = true;
  for (const locator of ignored.paths) {
    if (state.ignored.seen.size >= GREP_LIMITS.ignoredReported) {
      state.ignored.atLeast = true;
      break;
    }
    // A page that resumes inside a scope lists its ancestors again, so the
    // same excluded directory can arrive twice; the call names it once.
    if (state.ignored.seen.has(locator)) continue;
    state.ignored.seen.add(locator);
    // A literal clause matches text, so a reject written with the separator
    // must hide the directory written without it.
    if (!admission.allows(locator) || !admission.allows(`${locator}/`))
      continue;
    state.ignored.count += 1;
    if (state.ignored.paths.length < GREP_LIMITS.ignoredLocators)
      state.ignored.paths.push(locator);
  }
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

export function pageResult(state: PageState): ToolResult {
  return {
    status: 'success',
    results: state.results,
    complete: state.complete,
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    ...(state.unfinished !== undefined && {
      unfinishedFile: state.unfinished,
    }),
    ...(state.ignored.count > 0 && {
      ignored: {
        count: state.ignored.count,
        locators: state.ignored.paths.map(spellIgnoredLocator),
        ...(state.ignored.atLeast && { atLeast: true }),
      },
    }),
    ...(carriesKnowledgePassage(state.results) && {
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }),
  };
}

/**
 * Whether the page holds a Knowledge passage. Knowledge content is untrusted
 * in the same way a `kb://` read is, so the whole page carries the closed
 * notice, exactly as `read` and `knowledge_search` do.
 */
function carriesKnowledgePassage(results: ReadonlyArray<GrepPassage>): boolean {
  return results.some((passage) =>
    passage.locator.startsWith(`${KNOWLEDGE_LOCATOR_SCHEME}://`),
  );
}
