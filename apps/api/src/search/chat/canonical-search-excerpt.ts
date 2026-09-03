import type { CanonicalSearchPreviewPassage } from './canonical-search-matcher';

export type { CanonicalSearchPreviewPassage } from './canonical-search-matcher';

export const CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS = 500;

/**
 * Render the complete selected line window and crop only its discovery
 * presentation. The matcher coordinates remain untouched so the same
 * message-local range can be handed to `conversation_read`.
 */
export function buildCanonicalSearchExcerpt(
  passage: CanonicalSearchPreviewPassage,
): string {
  const firstLine = passage.lines[0];
  const lastLine = passage.lines.at(-1);
  if (firstLine === undefined || lastLine === undefined) return '';

  const source = passage.lines
    .map((line) => `${line.text}${line.delimiter}`)
    .join('');
  const codePoints = Array.from(source);
  if (codePoints.length <= CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS) {
    return source;
  }

  const passageStart = firstLine.startOffset;
  const anchorStart = codePointIndexAtUtf16Offset(
    source,
    passage.anchor.startOffset - passageStart,
  );
  const anchorEnd = codePointIndexAtUtf16Offset(
    source,
    passage.anchor.endOffsetExclusive - passageStart,
  );

  if (passage.anchor.kind === 'fallback') {
    return cropFromFallbackAnchor(codePoints, anchorStart);
  }

  return cropAroundExactAnchor(codePoints, anchorStart, anchorEnd);
}

function cropFromFallbackAnchor(
  codePoints: ReadonlyArray<string>,
  anchorStart: number,
): string {
  const start = clamp(anchorStart, 0, codePoints.length);
  const contentLimit = CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS - 1;
  const end = Math.min(codePoints.length, start + contentLimit);
  const suffix = end < codePoints.length ? '…' : '';
  return `${codePoints.slice(start, end).join('')}${suffix}`;
}

function cropAroundExactAnchor(
  codePoints: ReadonlyArray<string>,
  anchorStart: number,
  anchorEnd: number,
): string {
  const contentLimit = CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS - 2;
  const startAnchor = clamp(anchorStart, 0, codePoints.length);
  const endAnchor = clamp(
    Math.max(anchorEnd, startAnchor),
    0,
    codePoints.length,
  );
  let windowStart = Math.max(
    0,
    Math.floor((startAnchor + endAnchor) / 2 - contentLimit / 2),
  );
  let windowEnd = Math.min(codePoints.length, windowStart + contentLimit);

  if (windowEnd < endAnchor) {
    windowStart = Math.max(0, endAnchor - contentLimit);
    windowEnd = Math.min(codePoints.length, windowStart + contentLimit);
  }
  if (windowEnd - windowStart < contentLimit) {
    windowStart = Math.max(0, windowEnd - contentLimit);
  }

  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < codePoints.length ? '…' : '';
  return `${prefix}${codePoints.slice(windowStart, windowEnd).join('')}${suffix}`;
}

function codePointIndexAtUtf16Offset(value: string, offset: number): number {
  const bounded = clamp(offset, 0, value.length);
  let utf16Offset = 0;
  let codePointOffset = 0;
  for (const character of value) {
    if (utf16Offset >= bounded) break;
    utf16Offset += character.length;
    codePointOffset += 1;
  }
  return codePointOffset;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
