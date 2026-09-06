import { sql } from 'drizzle-orm';

import {
  scanConversationLogicalLines,
  type ConversationLogicalLine,
} from '@workspace/runtime-safety';
import type { Db } from '../../db/tenant-db.service';
import { normalizeForSearch } from '../core/text';
import type {
  CanonicalSearchMessage,
  HydratedCanonicalSearchDocument,
} from './canonical-search-hydrator';

export type { CanonicalSearchMessage } from './canonical-search-hydrator';

export const CANONICAL_SEARCH_MAX_PASSAGE_LINES = 2000;

export type CanonicalLogicalLine = ConversationLogicalLine;

export type CanonicalLinePredicateCandidate = {
  id: number;
  normalizedText: string;
};

/**
 * The matcher owns normalization. An evaluator receives already-normalized
 * values and must apply the same PostgreSQL predicates as the ranked search.
 * Keeping this as a batch callback makes pure matcher tests cheap while the
 * production adapter still evaluates every predicate in one SQL statement.
 */
export type CanonicalLinePredicateEvaluator = (
  normalizedQuery: string,
  candidates: ReadonlyArray<CanonicalLinePredicateCandidate>,
) => Promise<ReadonlySet<number>>;

export type CanonicalSearchPreviewLine = CanonicalLogicalLine;

export type CanonicalSearchPreviewAnchor = {
  line: number;
  startOffset: number;
  endOffsetExclusive: number;
  kind: 'exact' | 'fallback';
};

export type CanonicalSearchPreviewPassage = {
  message: Pick<CanonicalSearchMessage, 'messageSeq' | 'role' | 'timestamp'>;
  offset: number;
  limit: number;
  lines: ReadonlyArray<CanonicalSearchPreviewLine>;
  anchor: CanonicalSearchPreviewAnchor;
};

type InternalLine = {
  id: number;
  message: CanonicalSearchMessage;
  logical: CanonicalLogicalLine;
  sourceStart: number;
  sourceEndExclusive: number;
  normalizedText: string;
};

type MatchedLine = {
  line: InternalLine;
  anchor: CanonicalSearchPreviewAnchor;
};

type LineInterval = {
  start: number;
  end: number;
  matches: ReadonlyArray<MatchedLine>;
};

type NormalizedSegment = {
  normalizedStart: number;
  normalizedEndExclusive: number;
  rawStart: number;
  rawEndExclusive: number;
};

type NormalizedMapping = {
  normalized: string;
  segments: ReadonlyArray<NormalizedSegment>;
};

/**
 * Scan the same logical line shape used by the bounded conversation reader:
 * LF terminates a line, CRLF is one delimiter, lone CR is text, blanks count,
 * and a terminal delimiter does not create a phantom line.
 */
export const scanCanonicalLogicalLines = scanConversationLogicalLines;

/**
 * Evaluate line-local FTS, trigram, and escaped-substring predicates using the
 * real PostgreSQL operators used by the ranked search. The caller supplies the
 * owner-scoped transaction; this function never opens or widens a DB scope.
 */
export async function evaluateCanonicalLinePredicates(
  tx: Db,
  normalizedQuery: string,
  candidates: ReadonlyArray<CanonicalLinePredicateCandidate>,
): Promise<ReadonlySet<number>> {
  if (normalizedQuery.length === 0 || candidates.length === 0) return new Set();

  const likePattern = `%${normalizedQuery.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;
  const values = sql.join(
    candidates.map(
      (candidate) => sql`(${candidate.id}, ${candidate.normalizedText})`,
    ),
    sql`, `,
  );
  const rows = await tx.execute<{ line_id: number | string }>(sql`
    WITH candidates(line_id, normalized_text) AS (
      VALUES ${values}
    ), query_input AS (
      SELECT
        ${normalizedQuery}::text AS raw,
        websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq,
        ${likePattern}::text AS like_pattern
    )
    SELECT c.line_id
    FROM candidates AS c
    CROSS JOIN query_input AS q
    WHERE to_tsvector('simple', c.normalized_text) @@ q.tsq
       OR q.raw <% c.normalized_text
       OR c.normalized_text ILIKE q.like_pattern
    ORDER BY c.line_id
  `);

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  return new Set(
    [...rows]
      .map((row) => Number(row.line_id))
      .filter((id) => Number.isSafeInteger(id) && candidateIds.has(id)),
  );
}

/**
 * Select the one canonical discovery passage for a hydrated projection
 * document. Ranking has already happened before this function is called; the
 * result is selected only by canonical message sequence and line offset.
 */
export async function matchCanonicalSearchPreview(
  document: HydratedCanonicalSearchDocument,
  query: string,
  evaluate: CanonicalLinePredicateEvaluator,
): Promise<CanonicalSearchPreviewPassage | null> {
  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery.length === 0) return null;

  const internalLines = buildInternalLines(document);
  if (internalLines.length === 0) return null;

  const matchingIds = await evaluate(
    normalizedQuery,
    internalLines.map(({ id, normalizedText }) => ({ id, normalizedText })),
  );
  const matchedLines = internalLines
    .filter((line) => matchingIds.has(line.id))
    .map((line) => ({
      line,
      anchor: makeAnchor(line, normalizedQuery),
    }));

  if (matchedLines.length === 0) return null;

  return selectPreviewPassage(matchedLines);
}

/** Rank `matchedLines`' passages by earliest message/offset and select the
 *  first — split out of `matchCanonicalSearchPreview` purely for its own
 *  line budget. */
function selectPreviewPassage(
  matchedLines: ReadonlyArray<MatchedLine>,
): CanonicalSearchPreviewPassage | null {
  const passages = buildPassages(matchedLines);
  passages.sort((left, right) => {
    const leftSeq =
      left.matches[0]?.line.message.messageSeq ?? Number.MAX_SAFE_INTEGER;
    const rightSeq =
      right.matches[0]?.line.message.messageSeq ?? Number.MAX_SAFE_INTEGER;
    return leftSeq - rightSeq || left.start - right.start;
  });

  const selected = passages[0];
  if (selected === undefined) return null;

  const firstMatch = selected.matches[0];
  if (firstMatch === undefined) return null;
  const selectedLines = scanConversationLogicalLines(
    firstMatch.line.message.visibleText,
  ).slice(selected.start, selected.end + 1);

  return {
    message: {
      messageSeq: firstMatch.line.message.messageSeq,
      role: firstMatch.line.message.role,
      timestamp: firstMatch.line.message.timestamp,
    },
    offset: selected.start,
    limit: selected.end - selected.start + 1,
    lines: selectedLines,
    anchor: firstMatch.anchor,
  };
}

/** One message's candidate lines, id-numbered starting at `startId` — split
 *  out of `buildInternalLines` purely for its own line budget. `nextId` lets
 *  the caller keep ids monotonic and contiguous across every message,
 *  exactly as the original single loop did. */
function linesFromMessage(message: CanonicalSearchMessage, startId: number) {
  const lines: Array<InternalLine> = [];
  let id = startId;
  if (
    !Number.isSafeInteger(message.sourceStart) ||
    !Number.isSafeInteger(message.sourceEndExclusive) ||
    message.sourceStart < 0 ||
    message.sourceStart > message.sourceEndExclusive ||
    message.sourceEndExclusive > message.visibleText.length
  ) {
    return { lines, nextId: id };
  }

  for (const logical of scanConversationLogicalLines(message.visibleText)) {
    const sourceStart = Math.max(logical.startOffset, message.sourceStart);
    const sourceEndExclusive = Math.min(
      logical.endOffsetExclusive,
      message.sourceEndExclusive,
    );
    if (sourceStart >= sourceEndExclusive) continue;

    const sourceText = message.visibleText.slice(
      sourceStart,
      sourceEndExclusive,
    );
    const normalizedText = normalizeForSearch(sourceText);
    if (normalizedText.length === 0) continue;
    lines.push({
      id,
      message,
      logical,
      sourceStart,
      sourceEndExclusive,
      normalizedText,
    });
    id += 1;
  }
  return { lines, nextId: id };
}

function buildInternalLines(
  document: HydratedCanonicalSearchDocument,
): Array<InternalLine> {
  const result: Array<InternalLine> = [];
  let id = 0;
  const messages = document.messages
    .map((message, index) => ({ message, index }))
    .sort(
      (left, right) =>
        left.message.messageSeq - right.message.messageSeq ||
        left.index - right.index,
    );

  for (const { message } of messages) {
    const { lines, nextId } = linesFromMessage(message, id);
    result.push(...lines);
    id = nextId;
  }

  return result;
}

/** Every occurrence of `normalizedQuery` in `line.normalizedText`, mapped
 *  back to a raw-text anchor via `mapping` — the first one that maps cleanly
 *  wins. Split out of `makeAnchor` purely for its own line budget. */
function findExactAnchor(
  line: InternalLine,
  raw: string,
  normalizedQuery: string,
  mapping: NormalizedMapping,
): CanonicalSearchPreviewAnchor | undefined {
  for (
    let occurrence = line.normalizedText.indexOf(normalizedQuery);
    occurrence >= 0;
    occurrence = line.normalizedText.indexOf(normalizedQuery, occurrence + 1)
  ) {
    const mapped = mapNormalizedOccurrence(
      raw,
      mapping,
      normalizedQuery,
      occurrence,
    );
    if (mapped !== undefined) {
      return {
        line: line.logical.line,
        startOffset: line.sourceStart + mapped.startOffset,
        endOffsetExclusive: line.sourceStart + mapped.endOffsetExclusive,
        kind: 'exact',
      };
    }
  }
  return undefined;
}

function makeAnchor(
  line: InternalLine,
  normalizedQuery: string,
): CanonicalSearchPreviewAnchor {
  const raw = line.message.visibleText.slice(
    line.sourceStart,
    line.sourceEndExclusive,
  );
  const mapping = buildNormalizedMapping(raw, line.normalizedText);
  const exact =
    mapping === undefined
      ? undefined
      : findExactAnchor(line, raw, normalizedQuery, mapping);
  if (exact !== undefined) return exact;

  return {
    line: line.logical.line,
    startOffset: line.sourceStart,
    endOffsetExclusive: firstCodePointEnd(
      line.message.visibleText,
      line.sourceStart,
      line.sourceEndExclusive,
    ),
    kind: 'fallback',
  };
}

function firstCodePointEnd(
  text: string,
  startOffset: number,
  endOffsetExclusive: number,
): number {
  const codePoint = text.codePointAt(startOffset);
  if (codePoint === undefined) return startOffset;
  return Math.min(
    endOffsetExclusive,
    startOffset + (codePoint > 0xff_ff ? 2 : 1),
  );
}

function buildPassages(
  matchedLines: ReadonlyArray<MatchedLine>,
): Array<LineInterval> {
  const grouped = new Map<number, Array<MatchedLine>>();
  for (const match of matchedLines) {
    const group = grouped.get(match.line.message.messageSeq);
    if (group === undefined)
      grouped.set(match.line.message.messageSeq, [match]);
    else group.push(match);
  }

  const passages: Array<LineInterval> = [];
  for (const group of grouped.values()) {
    group.sort(
      (left, right) => left.line.logical.line - right.line.logical.line,
    );
    const totalLines = scanConversationLogicalLines(
      group[0]?.line.message.visibleText ?? '',
    ).length;
    if (totalLines === 0) continue;

    let current: LineInterval | undefined;
    for (const match of group) {
      const start = Math.max(0, match.line.logical.line - 1);
      const end = Math.min(totalLines - 1, match.line.logical.line + 1);
      if (current === undefined) {
        current = { start, end, matches: [match] };
      } else if (start <= current.end + 1) {
        current = {
          start: current.start,
          end: Math.max(current.end, end),
          matches: [...current.matches, match],
        };
      } else {
        passages.push(...partitionInterval(current));
        current = { start, end, matches: [match] };
      }
    }
    if (current !== undefined) passages.push(...partitionInterval(current));
  }

  return passages;
}

function partitionInterval(interval: LineInterval): Array<LineInterval> {
  const result: Array<LineInterval> = [];
  let start = interval.start;
  let remainingMatches = [...interval.matches];

  while (interval.end - start + 1 > CANONICAL_SEARCH_MAX_PASSAGE_LINES) {
    const lastMatch = remainingMatches.at(-1);
    if (lastMatch === undefined) break;
    const boundary = Math.min(
      start + CANONICAL_SEARCH_MAX_PASSAGE_LINES - 1,
      lastMatch.line.logical.line - 1,
    );
    if (boundary < start) break;
    const partitionMatches = remainingMatches.filter(
      (match) => match.line.logical.line <= boundary,
    );
    if (partitionMatches.length === 0) break;
    result.push({ start, end: boundary, matches: partitionMatches });
    remainingMatches = remainingMatches.filter(
      (match) => match.line.logical.line > boundary,
    );
    start = boundary + 1;
  }

  if (remainingMatches.length > 0) {
    result.push({ start, end: interval.end, matches: remainingMatches });
  }
  return result;
}

function mapNormalizedOccurrence(
  raw: string,
  mapping: NormalizedMapping,
  query: string,
  occurrence: number,
): { startOffset: number; endOffsetExclusive: number } | undefined {
  const occurrenceEnd = occurrence + query.length;
  const segments = mapping.segments.filter(
    (segment) =>
      segment.normalizedStart < occurrenceEnd &&
      segment.normalizedEndExclusive > occurrence,
  );
  const first = segments[0];
  const last = segments.at(-1);
  if (first === undefined || last === undefined) return undefined;

  const startOffset = first.rawStart;
  const endOffsetExclusive = last.rawEndExclusive;
  if (
    normalizeForSearch(raw.slice(startOffset, endOffsetExclusive)) !== query
  ) {
    return undefined;
  }
  return { startOffset, endOffsetExclusive };
}

/** A raw-text fragment or token: its (possibly transformed) text plus the
 *  raw-offset span it came from. Shared shape for both `buildNormalizedMapping`
 *  phases that produce one. */
type NormalizedFragment = {
  text: string;
  rawStart: number;
  rawEndExclusive: number;
};

/** Group `raw` into combining-mark clusters — NFKC can compose adjacent
 *  Unicode code points, so a base character and its combining marks must
 *  normalize together. Phase 1 of `buildNormalizedMapping`. */
function buildCombiningMarkFragments(raw: string): Array<NormalizedFragment> {
  const fragments: Array<NormalizedFragment> = [];
  for (let offset = 0; offset < raw.length; ) {
    const rawStart = offset;
    const firstCodePoint = raw.codePointAt(offset);
    if (firstCodePoint === undefined) break;
    offset += firstCodePoint > 0xff_ff ? 2 : 1;
    while (offset < raw.length) {
      const codePoint = raw.codePointAt(offset);
      if (codePoint === undefined || !isCombiningMark(codePoint)) break;
      offset += codePoint > 0xff_ff ? 2 : 1;
    }
    const rawEndExclusive = offset;
    fragments.push({
      text: raw.slice(rawStart, rawEndExclusive).normalize('NFKC'),
      rawStart,
      rawEndExclusive,
    });
  }
  return fragments;
}

/** Append one fragment-derived character to `tokens`, collapsing adjacent
 *  whitespace into a single `' '` token — the per-character body of
 *  `tokenizeFragments`'s double loop, split out to keep that loop's own
 *  nesting shallow. */
function appendNormalizedToken(
  tokens: Array<NormalizedFragment>,
  character: string,
  fragment: NormalizedFragment,
): void {
  if (!/\s/u.test(character)) {
    tokens.push({
      text: character,
      rawStart: fragment.rawStart,
      rawEndExclusive: fragment.rawEndExclusive,
    });
    return;
  }
  const previous = tokens.at(-1);
  if (previous?.text === ' ') {
    previous.rawEndExclusive = fragment.rawEndExclusive;
  } else {
    tokens.push({
      text: ' ',
      rawStart: fragment.rawStart,
      rawEndExclusive: fragment.rawEndExclusive,
    });
  }
}

/** Whitespace-collapsed, boundary-trimmed tokens from `fragments`. Phase 2
 *  of `buildNormalizedMapping`. */
function tokenizeFragments(
  fragments: ReadonlyArray<NormalizedFragment>,
): Array<NormalizedFragment> {
  const tokens: Array<NormalizedFragment> = [];
  for (const fragment of fragments) {
    for (const character of Array.from(fragment.text)) {
      appendNormalizedToken(tokens, character, fragment);
    }
  }
  while (tokens[0]?.text === ' ') tokens.shift();
  while (tokens.at(-1)?.text === ' ') tokens.pop();
  return tokens;
}

/** Fold `tokens` to lowercase and verify the result matches
 *  `expectedNormalized` — undefined (caller falls back) on any mismatch,
 *  including a folded length that doesn't sum to the whole normalized
 *  string's length. Phase 3 of `buildNormalizedMapping`. */
function foldAndVerifyTokens(
  tokens: ReadonlyArray<NormalizedFragment>,
  expectedNormalized: string,
): { normalized: string; foldedFragments: Array<string> } | undefined {
  const preLowerNormalized = tokens.map((token) => token.text).join('');
  const normalized = preLowerNormalized.toLowerCase();
  if (normalized !== expectedNormalized) return undefined;

  const foldedFragments = tokens.map((token) => token.text.toLowerCase());
  if (
    foldedFragments.reduce((total, fragment) => total + fragment.length, 0) !==
    normalized.length
  ) {
    return undefined;
  }
  return { normalized, foldedFragments };
}

/** Build the normalized-offset ↔ raw-offset segment list from `tokens` and
 *  their folded text. Phase 4 of `buildNormalizedMapping`. */
function buildNormalizedSegments(
  tokens: ReadonlyArray<NormalizedFragment>,
  foldedFragments: ReadonlyArray<string>,
  normalizedLength: number,
): Array<NormalizedSegment> | undefined {
  const segments: Array<NormalizedSegment> = [];
  let normalizedOffset = 0;
  for (const [index, token] of tokens.entries()) {
    const foldedFragment = foldedFragments[index];
    if (foldedFragment === undefined) return undefined;
    const normalizedEndExclusive = normalizedOffset + foldedFragment.length;
    if (
      normalizedEndExclusive <= normalizedOffset ||
      normalizedEndExclusive > normalizedLength
    ) {
      return undefined;
    }
    segments.push({
      normalizedStart: normalizedOffset,
      normalizedEndExclusive,
      rawStart: token.rawStart,
      rawEndExclusive: token.rawEndExclusive,
    });
    normalizedOffset = normalizedEndExclusive;
  }
  if (normalizedOffset !== normalizedLength) return undefined;
  return segments;
}

/**
 * Build a conservative raw-to-normalized map. NFKC can compose adjacent
 * Unicode code points, so combining-mark clusters are normalized together. If
 * the mapped output ever diverges from the canonical normalized candidate, the
 * caller intentionally falls back instead of returning a false raw span.
 */
function buildNormalizedMapping(
  raw: string,
  expectedNormalized: string,
): NormalizedMapping | undefined {
  const fragments = buildCombiningMarkFragments(raw);
  const tokens = tokenizeFragments(fragments);

  const folded = foldAndVerifyTokens(tokens, expectedNormalized);
  if (folded === undefined) return undefined;
  const { normalized, foldedFragments } = folded;

  const segments = buildNormalizedSegments(
    tokens,
    foldedFragments,
    normalized.length,
  );
  if (segments === undefined) return undefined;

  return { normalized, segments };
}

function isCombiningMark(codePoint: number): boolean {
  return /\p{Mark}/u.test(String.fromCodePoint(codePoint));
}
