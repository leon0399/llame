/**
 * The call's results across its segments. Each segment — one host scope or one
 * Machine — reports what it kept and what it consumed, and this module appends
 * it, so the bounds, the counts, and the order never depend on which backend
 * produced a passage. The engine's pages are internal to a walk: a passage it
 * cut at its own page bound and the passage that continues it are one passage
 * of the result.
 *
 * The passages are also the artifact text while the walk runs (design D7): each
 * one appends its rendered block, its UTF-8 bytes, and its artifact line
 * numbers, so the walk stops at `tools.artifacts.maxBytes` without rendering
 * the result a second time.
 */

import {
  GREP_LIMITS,
  grepFileLocator,
  grepPassageBlockLines,
  grepPassageContinues,
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
import { type ArtifactFinding } from './artifacts/findings';
import { artifactLineCount } from './artifacts/lines';
import { type GrepReadAdmission } from './grep-admission';
import { type ToolResult } from './types';

/** A reported exclusion in the spelling its scheme's scope uses. */
function spellIgnoredLocator(locator: string): string {
  return locator.startsWith('machine://')
    ? spellGrepMachineScopeLocator(locator)
    : spellGrepHostScopeLocator(locator);
}

/** One passage's block in the artifact text. */
type ArtifactBlock = {
  /** The heading line or blank separator, then the passage's own lines. */
  readonly lines: ReadonlyArray<string>;
  /** UTF-8 bytes of the block's lines, each with its line terminator. */
  readonly bytes: number;
  /** Artifact-numbered lines the block holds, 8,000-unit pieces included. */
  readonly pieces: number;
  /** The block opens a file run, so its ranges start here. */
  readonly newRun: boolean;
};

/** The artifact text one call accumulates while its walk runs. */
export type GrepArtifact = {
  /** The passages the artifact holds, in result order. */
  readonly results: Array<GrepPassage>;
  /** One block for each passage, parallel to `results`. */
  readonly blocks: Array<ArtifactBlock>;
  /** The rendered body lines, the Knowledge notice line excluded. */
  readonly lines: Array<string>;
  /** The body's UTF-8 bytes, each line with its terminator. */
  lineBytes: number;
  /** The body's artifact-numbered lines, 8,000-unit pieces included. */
  lineCount: number;
  /**
   * Bytes the notice line and its terminator take once a Knowledge passage
   * arrives. Kept back from the bound from the first passage, because a
   * `kb://` scope can give one at any point of the walk.
   */
  readonly noticeBytes: number;
  /** The byte bound stopped the artifact before a passage. */
  full: boolean;
  readonly maxBytes: number;
};

/** What one call's artifact starts with. */
export type GrepArtifactOptions = {
  readonly maxBytes: number;
  /** A `kb://` scope is among the call's segments. */
  readonly mayCarryKnowledge: boolean;
};

export function createGrepArtifact(options: GrepArtifactOptions): GrepArtifact {
  return {
    results: [],
    blocks: [],
    lines: [],
    lineBytes: 0,
    lineCount: 0,
    noticeBytes: options.mayCarryKnowledge
      ? Buffer.byteLength(`notice: ${KNOWLEDGE_CONTENT_NOTICE}`, 'utf8') + 1
      : 0,
    full: false,
    maxBytes: options.maxBytes,
  };
}

/**
 * The bytes of the artifact text so far: every line and its terminator,
 * except the terminator the last line does not take, plus the notice line the
 * whole result may still need.
 */
export function grepArtifactBytes(artifact: GrepArtifact): number {
  if (artifact.lineCount === 0) return 0;
  return artifact.lineBytes - 1 + artifact.noticeBytes;
}

/** The bytes the artifact can still take. */
export function grepArtifactBytesLeft(artifact: GrepArtifact): number {
  return artifact.maxBytes - grepArtifactBytes(artifact);
}

/**
 * Keep one page's passages, in walk order, as the artifact text. A passage
 * that does not fit ends the artifact: it is not stored, and the call stops at
 * the bound. The count of kept passages is the return.
 */
export function addGrepPassages(
  artifact: GrepArtifact,
  passages: ReadonlyArray<GrepPassage>,
): boolean {
  for (const passage of passages) {
    const previous = artifact.results.at(-1);
    const merged =
      previous === undefined ? undefined : mergeCutPassage(previous, passage);
    if (
      merged !== undefined
        ? !replaceCutPassage(artifact, merged)
        : !appendBlock(artifact, passage)
    )
      return false;
  }
  return true;
}

/** Append one passage's block, or end the artifact when it does not fit. */
function appendBlock(artifact: GrepArtifact, passage: GrepPassage): boolean {
  const block = artifactBlock(artifact.results.at(-1), passage);
  if (grepArtifactBytes(artifact) + block.bytes > artifact.maxBytes) {
    artifact.full = true;
    return false;
  }
  artifact.results.push(passage);
  artifact.blocks.push(block);
  artifact.lines.push(...block.lines);
  artifact.lineBytes += block.bytes;
  artifact.lineCount += block.pieces;
  return true;
}

/**
 * The artifact block of one passage, rendered as the artifact holds it: no
 * inline cut marker, because the artifact is the rest that marker names.
 */
function artifactBlock(
  previous: GrepPassage | undefined,
  passage: GrepPassage,
): ArtifactBlock {
  const lines = grepPassageBlockLines(previous, passage, false);
  return {
    lines,
    bytes: lines.reduce(
      (total, line) => total + Buffer.byteLength(line, 'utf8') + 1,
      0,
    ),
    pieces: lines.reduce((total, line) => total + artifactLineCount(line), 0),
    newRun: !grepPassageContinues(previous, passage),
  };
}

/**
 * The passage a page cut and the passage that continues it, as one passage:
 * the artifact renders the joined block in place of the cut one, and its byte
 * count replaces the old block's.
 */
function replaceCutPassage(
  artifact: GrepArtifact,
  merged: GrepPassage,
): boolean {
  const index = artifact.results.length - 1;
  const previous = index === 0 ? undefined : artifact.results[index - 1];
  const old = artifact.blocks[index];
  const block = artifactBlock(previous, merged);
  const delta = block.bytes - old.bytes;
  if (grepArtifactBytes(artifact) + delta > artifact.maxBytes) {
    artifact.full = true;
    return false;
  }
  artifact.results[index] = merged;
  artifact.blocks[index] = block;
  artifact.lines.splice(
    artifact.lines.length - old.lines.length,
    old.lines.length,
    ...block.lines,
  );
  artifact.lineBytes += delta;
  artifact.lineCount += block.pieces - old.pieces;
  return true;
}

/** Whether the whole result carries the Knowledge notice. */
export function grepArtifactHasNotice(artifact: GrepArtifact): boolean {
  return artifact.noticeBytes > 0 && carriesKnowledgePassage(artifact.results);
}

/** The stored text of the artifact: the notice line, then the passages. */
export function grepArtifactText(artifact: GrepArtifact): string {
  const lines = grepArtifactHasNotice(artifact)
    ? [`notice: ${KNOWLEDGE_CONTENT_NOTICE}`, ...artifact.lines]
    : artifact.lines;
  return lines.join('\n');
}

/** The artifact-numbered lines the stored text holds. */
export function grepArtifactLineCount(artifact: GrepArtifact): number {
  return artifact.lineCount + (grepArtifactHasNotice(artifact) ? 1 : 0);
}

/**
 * One finding for each file run the artifact holds: its file locator, the
 * `allow_only` rule that admitted it, and its artifact line range, the heading
 * line included (design D5).
 */
export function grepArtifactFindings(
  artifact: GrepArtifact,
): Array<ArtifactFinding> {
  const findings: Array<ArtifactFinding> = [];
  let line = grepArtifactHasNotice(artifact) ? 1 : 0;
  let current: ArtifactFinding | undefined;
  for (const [index, block] of artifact.blocks.entries()) {
    const start = line + 1;
    line += block.pieces;
    if (block.newRun) {
      if (current !== undefined) findings.push(current);
      current = {
        locators: [grepFileLocator(artifact.results[index].locator)],
        rule: 'allow_only',
        start,
        end: line,
      };
      continue;
    }
    // `current` exists whenever a block continues a run.
    if (current !== undefined) {
      current = { ...current, end: line };
    }
  }
  if (current !== undefined) findings.push(current);
  return findings;
}

/** What one segment contributes before the call's result is assembled. */
export type SegmentPage = {
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
  readonly artifact: GrepArtifact;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  /** Whether the walk reached the end of the last scope. */
  complete: boolean;
  /** Whether the call got past the point it started at. */
  progressed: boolean;
  /** The file's locator a bound stopped the call inside before any progress. */
  unfinished: string | undefined;
  /** The artifact bound already ended the call. */
  artifactBound: boolean;
  /** The excluded directories the `read` group admitted, in canonical order. */
  ignored: {
    readonly paths: Array<string>;
    /** Every locator already counted, so two pages count a directory once. */
    readonly seen: Set<string>;
    count: number;
    atLeast: boolean;
  };
};

export function createPageState(options: GrepArtifactOptions): PageState {
  return {
    artifact: createGrepArtifact(options),
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    complete: true,
    progressed: false,
    unfinished: undefined,
    artifactBound: false,
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

/** Fold one segment's counts into the call; the caller records the stop. */
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
  // The continuation starts after the cut, so the pieces share no line and
  // their matches are already in line order.
  const matches = [...previous.matches, ...next.matches];
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

/** The excluded-directory report a result carries, in its scope spelling. */
export function ignoredReportOf(state: PageState):
  | {
      readonly count: number;
      readonly locators: ReadonlyArray<string>;
      readonly atLeast: boolean;
    }
  | undefined {
  if (state.ignored.count === 0) return undefined;
  return {
    count: state.ignored.count,
    locators: state.ignored.paths.map(spellIgnoredLocator),
    atLeast: state.ignored.atLeast,
  };
}

/**
 * The stored result. `results` is the inline part: every passage the artifact
 * holds by default, or the head the inline bound keeps. The Knowledge notice
 * follows the whole result, so a passage after the inline part still makes the
 * text it heads untrusted.
 */
export function pageResult(
  state: PageState,
  results: ReadonlyArray<GrepPassage> = state.artifact.results,
): ToolResult & { status: 'success' } {
  const ignored = ignoredReportOf(state);
  return {
    status: 'success',
    results,
    complete: state.complete,
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    ...(state.unfinished !== undefined && {
      unfinishedFile: state.unfinished,
    }),
    ...(ignored !== undefined && { ignored }),
    ...(carriesKnowledgePassage(state.artifact.results) && {
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }),
  };
}

/**
 * Whether the result holds a Knowledge passage. Knowledge content is untrusted
 * in the same way a `kb://` read is, so the whole result carries the closed
 * notice, exactly as `read` and `knowledge_search` do.
 */
function carriesKnowledgePassage(results: ReadonlyArray<GrepPassage>): boolean {
  return results.some((passage) =>
    passage.locator.startsWith(`${KNOWLEDGE_LOCATOR_SCHEME}://`),
  );
}
