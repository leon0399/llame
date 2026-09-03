/**
 * UTF-16 surrogate-pair-safe string cutting. Corpus- and feature-agnostic: any
 * code that cuts a string at a budget-derived index needs this, whether the
 * budget is a search chunk (`search/core/chunking.ts`) or a tool-result cap
 * (`tools/result-truncation.ts`) — both used to carry their own copy of this
 * logic, which is exactly how a mid-pair-cut bug gets introduced twice. This
 * is the single source of truth; do not reimplement it locally.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd8_00 && code <= 0xdb_ff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc_00 && code <= 0xdf_ff;
}

/**
 * The safe index to cut `text` at, given a candidate `index`: steps back one
 * UTF-16 code unit when `index` falls between a high surrogate (at
 * `index - 1`) and its low surrogate (at `index`) — cutting there would leave
 * two unpaired surrogates behind, corrupting both halves once persisted as
 * UTF-8. Operates on indices only (no substring is taken), so a caller
 * advancing through a large string can call this at any offset without
 * slicing the string first.
 */
export function codePointSafeCutIndex(text: string, index: number): number {
  const splitsPair =
    isHighSurrogate(text.charCodeAt(index - 1)) &&
    isLowSurrogate(text.charCodeAt(index));
  return splitsPair ? index - 1 : index;
}

/**
 * Cut to `limit` UTF-16 code units, code-point-safe. Exported for direct
 * coverage: which `limit` a caller lands on depends on its payload, so a
 * result-level assertion alone does not reliably exercise a mid-pair cut.
 */
export function cutStringAtCodePointBoundary(
  value: string,
  limit: number,
): string {
  if (value.length <= limit) return value;
  return value.slice(0, codePointSafeCutIndex(value, limit));
}
