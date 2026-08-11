import { type ToolResult } from './types';

/** ~16KB result cap (D5/D6): oversized tool output is truncated, visibly. */
export const RESULT_TRUNCATE_CHARS = 16_000;

/**
 * Marker fields on a truncated result. They are written last, so a payload
 * field of the same name is overwritten: the marker has to sit at a fixed,
 * findable place, and a tool-declared `truncated` would otherwise be
 * indistinguishable from ours.
 */
const TRUNCATED_FIELD = 'truncated';
const NOTICE_FIELD = 'truncationNotice';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cut to `limit` UTF-16 code units, stepping back one unit when that offset
 * splits a surrogate pair — `slice` alone would emit a lone surrogate on any
 * emoji or non-BMP payload. Exported for direct coverage: which `limit` the
 * search below lands on depends on the payload, so a result-level assertion
 * alone does not reliably exercise a mid-pair cut.
 */
export function cutStringAtCodePointBoundary(
  value: string,
  limit: number,
): string {
  if (value.length <= limit) return value;
  const splitsPair =
    isHighSurrogate(value.charCodeAt(limit - 1)) &&
    isLowSurrogate(value.charCodeAt(limit));
  return value.slice(0, splitsPair ? limit - 1 : limit);
}

/**
 * Apply one shrink limit uniformly: strings keep their first `limit` code
 * units, arrays their first `limit` elements, nested objects their first
 * `limit` entries. Structure is preserved throughout — nothing is ever
 * re-serialized into a string, so redaction applied before truncation cannot
 * be defeated by an alternate representation (`mcp-tools` spec).
 */
function capValues(
  value: unknown,
  limit: number,
  keepAllEntries = false,
): unknown {
  if (typeof value === 'string') {
    return cutStringAtCodePointBoundary(value, limit);
  }
  if (Array.isArray(value)) {
    return value.slice(0, limit).map((entry) => capValues(entry, limit));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    return Object.fromEntries(
      (keepAllEntries ? entries : entries.slice(0, limit)).map(
        ([key, entry]) => [key, capValues(entry, limit)],
      ),
    );
  }
  // Numbers, booleans and null are already shorter than any useful limit.
  return value;
}

function truncationNotice(omittedChars: number): string {
  return (
    `Result truncated to fit the ${RESULT_TRUNCATE_CHARS}-character tool-result cap; ` +
    `${omittedChars} characters omitted. Re-run this tool with narrower ` +
    `arguments if you need the omitted content.`
  );
}

/**
 * Truncate an oversized SUCCESS result to the cap, keeping the shape the tool
 * declared (#294). The `status` discriminant and every top-level field survive
 * with their values shrunk in place; the model never receives a fragment of
 * the result's own serialization in place of the result.
 *
 * Error results are never truncated — every error message this registry
 * produces is a short, statically-authored string (see refusalResult /
 * invalidCallResult and the runner's catch branches), so an oversized error
 * can only mean a bug elsewhere, not something to silently cap here.
 */
export function truncateOversizedResult(result: ToolResult): ToolResult {
  if (result.status !== 'success') return result;
  const json = JSON.stringify(result);
  if (json.length <= RESULT_TRUNCATE_CHARS) return result;

  // Work on the result's own JSON projection: `JSON.stringify` has already
  // applied `toJSON`, dropped undefined, and fixed every length, so what is
  // measured below is exactly what the model receives.
  const { status: _status, ...payload } = JSON.parse(json) as Record<
    string,
    unknown
  >;

  const build = (limit: number): ToolResult => {
    const capped = capValues(payload, limit, true) as Record<string, unknown>;
    const omittedChars =
      json.length - JSON.stringify({ status: 'success', ...capped }).length;
    return {
      status: 'success',
      ...capped,
      [TRUNCATED_FIELD]: true,
      [NOTICE_FIELD]: truncationNotice(omittedChars),
    };
  };

  // The serialized length is monotone in `limit` (a larger limit only ever
  // keeps more payload, and the notice's own length shrinks by at most one
  // digit as the omitted count falls), so the largest fitting limit is a
  // binary search — measured against the real serialization rather than
  // computed from a budget. `limit = 0` is the floor: every top-level field
  // stays present with an emptied value, which for a pathological payload of
  // thousands of top-level keys is the one case that can still exceed the cap
  // — declared shape wins there, since no smaller shape exists.
  let low = 0;
  let high = json.length;
  let best = build(0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = build(mid);
    if (JSON.stringify(candidate).length <= RESULT_TRUNCATE_CHARS) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
