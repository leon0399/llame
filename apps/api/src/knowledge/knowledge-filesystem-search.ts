/**
 * Bounded, cancellable passage extraction over one file's already-decoded
 * text: the line-oriented occurrence scanner, the lookback/partition window
 * that groups nearby matches into one passage, and the excerpt windowing.
 * Consumed by `KnowledgeFilesystemAdapter.searchMarkdownFile` and by focused
 * unit tests directly.
 */

import {
  KNOWLEDGE_MAX_READ_LINES,
  KNOWLEDGE_MAX_SNIPPET_CODE_POINTS,
} from './knowledge-filesystem-limits';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import { throwIfAborted } from './knowledge-filesystem-io';
import type {
  KnowledgeFilesystemPassageOptions,
  KnowledgeFilesystemSearchAfter,
  KnowledgeFilesystemSearchMatch,
} from './knowledge-filesystem';

export function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareSearchMatches(
  left: KnowledgeFilesystemSearchMatch,
  right: KnowledgeFilesystemSearchMatch,
): number {
  const pathOrder = compareNames(left.path, right.path);
  return pathOrder !== 0 ? pathOrder : left.offset - right.offset;
}

export function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeFilesystemError('knowledge_content_invalid');
  }
}

type KnowledgeLogicalLine = {
  readonly line: number;
  readonly text: string;
  readonly delimiter: string;
};

type KnowledgeSearchOccurrence = {
  readonly line: number;
  readonly offset: number;
  readonly length: number;
};

type KnowledgeSearchActiveInterval = {
  start: number;
  end: number;
  partitionStart: number;
  partitionLines: Array<KnowledgeLogicalLine>;
  partitionFirstOccurrence?: KnowledgeSearchOccurrence;
  lastOccurrence: KnowledgeSearchOccurrence;
  lookahead: Array<KnowledgeLogicalLine>;
};

/** One logical line plus its predecessor and its (possibly absent) match. */
type KnowledgeSearchLineStep = {
  line: KnowledgeLogicalLine;
  previousLine: KnowledgeLogicalLine | undefined;
  occurrence: KnowledgeSearchOccurrence | undefined;
};

/**
 * Advance one active search interval by a single logical line: extend it,
 * split its partition once it outgrows the read-line cap, or emit and
 * restart/clear it once the line falls outside the lookback window. Returns
 * the interval to carry into the next line (`undefined` once closed).
 */
function advanceActiveInterval(
  step: KnowledgeSearchLineStep,
  active: KnowledgeSearchActiveInterval,
  ctx: KnowledgeSearchEmitContext,
): KnowledgeSearchActiveInterval | undefined {
  const { line, previousLine, occurrence } = step;
  if (occurrence !== undefined) {
    if (line.line <= active.end + 2) {
      appendKnowledgeSearchLookahead(active);
      appendKnowledgeSearchLine(active, line);
      active.end = Math.max(active.end, line.line + 1);
      active.lastOccurrence = occurrence;
      if (line.line > active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1) {
        splitKnowledgeSearchPartition(active, occurrence, ctx);
      } else if (active.partitionFirstOccurrence === undefined) {
        active.partitionFirstOccurrence = occurrence;
      }
      return active;
    }
    emitFinalKnowledgeSearchPartition(active, active.end, ctx);
    return startKnowledgeSearchInterval(line, previousLine, occurrence);
  }
  if (line.line <= active.end) {
    appendKnowledgeSearchLine(active, line);
    return active;
  }
  active.lookahead.push(line);
  if (line.line > active.end + 2) {
    emitFinalKnowledgeSearchPartition(active, active.end, ctx);
    return undefined;
  }
  return active;
}

/**
 * Bounded passage extraction shared by the live adapter and focused unit tests.
 * Logical lines intentionally match the ranged reader: only LF terminates a
 * line, and a preceding CR belongs to that delimiter as CRLF.
 */
/** Constant across the whole scan — the folded query and the emit context
 *  every line's occurrence check and interval update shares. */
type KnowledgeSearchScan = {
  readonly queryFolded: string;
  readonly ctx: KnowledgeSearchEmitContext;
};

/** Fold one line's occurrence into the running active interval — the body of
 *  `collectKnowledgePassages`'s scan loop, split out purely for its own line
 *  budget. Returns the interval to carry into the next line. */
function advanceKnowledgeSearchLine(
  line: KnowledgeLogicalLine,
  previousLine: KnowledgeLogicalLine | undefined,
  active: KnowledgeSearchActiveInterval | undefined,
  scan: KnowledgeSearchScan,
): KnowledgeSearchActiveInterval | undefined {
  const match = findLineOccurrence(line.text, scan.queryFolded);
  const occurrence =
    match === undefined ? undefined : { line: line.line, ...match };

  if (active === undefined) {
    return occurrence === undefined
      ? undefined
      : startKnowledgeSearchInterval(line, previousLine, occurrence);
  }
  const step: KnowledgeSearchLineStep = { line, previousLine, occurrence };
  return advanceActiveInterval(step, active, scan.ctx);
}

export async function collectKnowledgePassages(
  relativePath: string,
  text: string,
  query: string,
  options: KnowledgeFilesystemPassageOptions = {},
): Promise<Array<KnowledgeFilesystemSearchMatch>> {
  const queryFolded = query.toLowerCase();
  if (queryFolded.length === 0) return [];

  const passages: Array<KnowledgeFilesystemSearchMatch> = [];
  const ctx: KnowledgeSearchEmitContext = {
    relativePath,
    passages,
    after: options.after,
    maxResults: options.maxResults ?? Number.POSITIVE_INFINITY,
  };
  const scan: KnowledgeSearchScan = { queryFolded, ctx };
  let previousLine: KnowledgeLogicalLine | undefined;
  let active: KnowledgeSearchActiveInterval | undefined;
  let lastLine = -1;

  for await (const line of iterateKnowledgeLogicalLines(text, options.signal)) {
    lastLine = line.line;
    active = advanceKnowledgeSearchLine(line, previousLine, active, scan);
    previousLine = line;
  }

  if (active !== undefined) {
    emitFinalKnowledgeSearchPartition(
      active,
      Math.min(active.end, lastLine),
      ctx,
    );
  }

  return passages;
}

function startKnowledgeSearchInterval(
  line: KnowledgeLogicalLine,
  previousLine: KnowledgeLogicalLine | undefined,
  occurrence: KnowledgeSearchOccurrence,
): KnowledgeSearchActiveInterval {
  const start = Math.max(0, line.line - 1);
  const partitionLines =
    previousLine?.line === start ? [previousLine, line] : [line];
  return {
    start,
    end: line.line + 1,
    partitionStart: start,
    partitionLines,
    partitionFirstOccurrence: occurrence,
    lastOccurrence: occurrence,
    lookahead: [],
  };
}

function appendKnowledgeSearchLookahead(
  active: KnowledgeSearchActiveInterval,
): void {
  for (const line of active.lookahead) {
    appendKnowledgeSearchLine(active, line);
  }
  active.lookahead.length = 0;
}

function appendKnowledgeSearchLine(
  active: KnowledgeSearchActiveInterval,
  line: KnowledgeLogicalLine,
): void {
  if (line.line >= active.partitionStart) {
    active.partitionLines.push(line);
  }
}

function findLineOccurrence(
  line: string,
  queryFolded: string,
): Omit<KnowledgeSearchOccurrence, 'line'> | undefined {
  const folded = line.toLowerCase();
  const matchOffset = folded.indexOf(queryFolded);
  if (matchOffset < 0) return undefined;
  const sourceOffset = codePointOffsetForFoldedOffset(line, matchOffset);
  const sourceEnd = codePointOffsetForFoldedOffset(
    line,
    matchOffset + queryFolded.length,
  );
  return {
    offset: sourceOffset,
    length: Math.max(1, sourceEnd - sourceOffset),
  };
}

function makePassageExcerpt(
  lines: ReadonlyArray<KnowledgeLogicalLine>,
  partitionStart: number,
  occurrence: KnowledgeSearchOccurrence,
): string {
  const source = lines.map((line) => `${line.text}${line.delimiter}`).join('');
  const codePoints = Array.from(source);
  if (codePoints.length <= KNOWLEDGE_MAX_SNIPPET_CODE_POINTS) return source;

  let matchStart = 0;
  const occurrenceIndex = occurrence.line - partitionStart;
  for (const line of lines.slice(0, occurrenceIndex)) {
    matchStart += Array.from(`${line.text}${line.delimiter}`).length;
  }
  matchStart += occurrence.offset;
  const matchEnd = matchStart + occurrence.length;
  const visibleLength = KNOWLEDGE_MAX_SNIPPET_CODE_POINTS - 2;
  let windowStart = Math.max(0, matchStart - Math.floor(visibleLength / 2));
  let windowEnd = Math.min(codePoints.length, windowStart + visibleLength);
  if (windowEnd < matchEnd) {
    windowStart = Math.max(0, matchEnd - visibleLength);
    windowEnd = Math.min(codePoints.length, windowStart + visibleLength);
  }
  if (windowEnd - windowStart < visibleLength) {
    windowStart = Math.max(0, windowEnd - visibleLength);
  }
  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < codePoints.length ? '…' : '';
  return `${prefix}${codePoints.slice(windowStart, windowEnd).join('')}${suffix}`;
}

/** The search-wide state threaded through partition emission: where matched
 * passages accumulate and the cursor/cap that bounds them. Held constant
 * across one `collectKnowledgePassages` call. */
type KnowledgeSearchEmitContext = {
  relativePath: string;
  passages: Array<KnowledgeFilesystemSearchMatch>;
  after: KnowledgeFilesystemSearchAfter | undefined;
  maxResults: number;
};

function emitFinalKnowledgeSearchPartition(
  active: KnowledgeSearchActiveInterval,
  finalEnd: number,
  ctx: KnowledgeSearchEmitContext,
): void {
  const end = Math.min(active.end, finalEnd);
  if (end < active.partitionStart) return;
  const length = end - active.partitionStart + 1;
  if (length <= KNOWLEDGE_MAX_READ_LINES) {
    appendKnowledgeSearchPassage(
      active.partitionLines.slice(0, length),
      active.partitionStart,
      active.partitionFirstOccurrence,
      ctx,
    );
    return;
  }

  const boundary = Math.min(
    active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1,
    active.lastOccurrence.line - 1,
  );
  const firstLength = boundary - active.partitionStart + 1;
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(0, firstLength),
    active.partitionStart,
    active.partitionFirstOccurrence,
    ctx,
  );
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(firstLength, length),
    boundary + 1,
    active.lastOccurrence,
    ctx,
  );
}

function splitKnowledgeSearchPartition(
  active: KnowledgeSearchActiveInterval,
  nextOccurrence: KnowledgeSearchOccurrence,
  ctx: KnowledgeSearchEmitContext,
): void {
  const boundary = active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1;
  const prefixLength = boundary - active.partitionStart + 1;
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(0, prefixLength),
    active.partitionStart,
    active.partitionFirstOccurrence,
    ctx,
  );
  active.partitionStart = boundary + 1;
  active.partitionLines = active.partitionLines.slice(prefixLength);
  active.partitionFirstOccurrence = nextOccurrence;
}

function appendKnowledgeSearchPassage(
  lines: ReadonlyArray<KnowledgeLogicalLine>,
  offset: number,
  occurrence: KnowledgeSearchOccurrence | undefined,
  ctx: KnowledgeSearchEmitContext,
): void {
  const { relativePath, passages, after, maxResults } = ctx;
  if (
    occurrence === undefined ||
    !isAfterSearchCursor(
      { path: relativePath, offset, limit: lines.length, excerpt: '' },
      after,
    ) ||
    passages.length >= maxResults
  ) {
    return;
  }
  passages.push({
    path: relativePath,
    offset,
    limit: lines.length,
    excerpt: makePassageExcerpt(lines, offset, occurrence),
  });
}

async function* iterateKnowledgeLogicalLines(
  text: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<KnowledgeLogicalLine> {
  let lineStart = 0;
  let line = 0;
  let scannedCodeUnits = 0;
  for (let index = 0; index < text.length; index += 1) {
    scannedCodeUnits += 1;
    if (scannedCodeUnits % 65_536 === 0) {
      await yieldKnowledgeSearch(signal);
    }
    if (text.charCodeAt(index) !== 10) continue;
    const hasCr = index > lineStart && text.charCodeAt(index - 1) === 13;
    yield {
      line: line++,
      text: text.slice(lineStart, hasCr ? index - 1 : index),
      delimiter: hasCr ? '\r\n' : '\n',
    };
    if (line % 256 === 0) {
      await yieldKnowledgeSearch(signal);
    }
    lineStart = index + 1;
  }
  if (lineStart < text.length) {
    yield { line, text: text.slice(lineStart), delimiter: '' };
  }
  throwIfAborted(signal);
}

async function yieldKnowledgeSearch(
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
}

function isAfterSearchCursor(
  match: KnowledgeFilesystemSearchMatch,
  after: KnowledgeFilesystemSearchAfter | undefined,
): boolean {
  if (after === undefined) return true;
  return (
    compareNames(match.path, after.path) > 0 ||
    (match.path === after.path && match.offset > after.offset)
  );
}

function codePointOffsetForFoldedOffset(
  value: string,
  foldedOffset: number,
): number {
  let foldedCodeUnits = 0;
  let codePoints = 0;
  for (const character of value) {
    if (foldedCodeUnits >= foldedOffset) break;
    foldedCodeUnits += character.toLowerCase().length;
    codePoints += 1;
  }
  return codePoints;
}
