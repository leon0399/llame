import { cutStringAtCodePointBoundary } from '../code-point-boundary';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '../unknown-record';
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

/** A list the shrink shortened, reported by the marker so a count read off a
 * truncated list is not mistaken for the whole list. */
interface ShortenedList {
  readonly path: string;
  readonly kept: number;
  readonly total: number;
}

/** How many shortened lists the marker names before summarizing the rest. */
const NAMED_LIST_LIMIT = 3;

/**
 * Apply one shrink limit uniformly: strings keep their first `limit` code
 * units, arrays their first `limit` elements, nested objects their first
 * `limit` entries. Structure is preserved throughout — nothing is ever
 * re-serialized into a string, so redaction applied before truncation cannot
 * be defeated by an alternate representation (`mcp-tools` spec).
 *
 * Shortened lists are collected into `lists` as they are found: cut prose is
 * self-evident to a reader, but a list that quietly lost its tail reads as a
 * complete one, so the model is told what it kept of what.
 */
/** The JSON-like shape `capValues`/`capRecord` preserve while shortening. */
type CappedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<CappedValue>
  | { [key: string]: CappedValue };

/** The part of `capRecord`/`capValues`' recursion that never changes per
 * call — only `path` does, so it stays a separate argument. */
interface CapContext {
  readonly limit: number;
  readonly lists: Array<ShortenedList>;
  readonly keepAllEntries: boolean;
}

function capRecord(
  value: UnknownRecord,
  ctx: CapContext,
  path: string,
): { [key: string]: CappedValue } {
  const entries = Object.entries(value);
  return Object.fromEntries(
    (ctx.keepAllEntries ? entries : entries.slice(0, ctx.limit)).map(
      ([key, entry]) => [
        key,
        capValues(entry, ctx, path === '' ? key : `${path}.${key}`),
      ],
    ),
  );
}

function capValues(value: unknown, ctx: CapContext, path = ''): CappedValue {
  if (isString(value)) {
    return cutStringAtCodePointBoundary(value, ctx.limit);
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, ctx.limit);
    if (kept.length < value.length) {
      ctx.lists.push({
        path: path === '' ? 'the result' : path,
        kept: kept.length,
        total: value.length,
      });
    }
    return kept.map((entry, index) =>
      capValues(entry, ctx, `${path}[${index}]`),
    );
  }
  if (isRecord(value)) {
    return capRecord(value, ctx, path);
  }
  // Numbers, booleans, null, and undefined are already shorter than any
  // useful limit. Anything else (symbol, function, bigint) is not a shape a
  // JSON-ish tool result carries — fail closed instead of passing it through.
  if (
    value === null ||
    value === undefined ||
    isNumber(value) ||
    isBoolean(value)
  ) {
    return value;
  }
  throw new TypeError(
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- diagnostic interpolation naming the rejected value's runtime type in the thrown message, not narrowing it; no predicate form applies to a value already excluded from every accepted branch above.
    `Cannot truncate a tool-result value of type ${typeof value}.`,
  );
}

/**
 * Name the biggest shortened lists, then summarize the rest — a payload of
 * many small lists would otherwise spend the whole cap on its own marker.
 */
function shortenedListPhrase(lists: ReadonlyArray<ShortenedList>): string {
  if (lists.length === 0) return '';
  const ranked = [...lists].sort(
    (left, right) => right.total - right.kept - (left.total - left.kept),
  );
  const named = ranked
    .slice(0, NAMED_LIST_LIMIT)
    .map((list) => `${list.path} kept ${list.kept} of ${list.total}`)
    .join('; ');
  const remaining = ranked.length - Math.min(ranked.length, NAMED_LIST_LIMIT);
  const more = remaining > 0 ? ` (and ${remaining} more)` : '';
  return ` Lists shortened: ${named}${more}.`;
}

/** Only reachable via the last-resort pass below, where the cap outranks the
 * declared shape. */
function omittedFieldPhrase(
  omittedFields: number,
  totalFields: number,
): string {
  if (omittedFields === 0) return '';
  return ` ${omittedFields} of ${totalFields} result fields omitted entirely.`;
}

function truncationNotice(
  omittedChars: number,
  lists: ReadonlyArray<ShortenedList>,
  omittedFields: number,
  totalFields: number,
): string {
  return (
    `Result truncated to fit the ${RESULT_TRUNCATE_CHARS}-character tool-result cap; ` +
    `${omittedChars} characters omitted.${omittedFieldPhrase(omittedFields, totalFields)}` +
    `${shortenedListPhrase(lists)} ` +
    `Re-run this tool with narrower arguments if you need the omitted content.`
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
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || parsed.status !== 'success') {
    throw new TypeError('Malformed oversized tool result projection.');
  }
  const { status: _status, ...payload } = parsed;
  const source: TruncationSource = {
    payload,
    totalFields: Object.keys(payload).length,
    json,
  };

  // First pass keeps every top-level field, which is the shape guarantee. Its
  // floor is not free: a payload of thousands of top-level keys exceeds the cap
  // on the key names alone, with every value already emptied. The cap outranks
  // the shape there — an unbounded result is the thing the cap exists to keep
  // out of a provider request — so a second pass drops trailing fields too, and
  // the marker says how many. That pass always fits: its own floor is the
  // marker alone.
  const preserved = searchLargestFittingLimit(source, true);
  return JSON.stringify(preserved).length <= RESULT_TRUNCATE_CHARS
    ? preserved
    : searchLargestFittingLimit(source, false);
}

/** The part of a truncation pass that never changes across the binary
 * search's candidate limits. */
interface TruncationSource {
  readonly payload: UnknownRecord;
  readonly totalFields: number;
  readonly json: string;
}

function buildTruncatedResult(
  source: TruncationSource,
  limit: number,
  keepAllFields: boolean,
): ToolResult {
  const lists: Array<ShortenedList> = [];
  const capped = capRecord(
    source.payload,
    { limit, lists, keepAllEntries: keepAllFields },
    '',
  );
  const omittedChars =
    source.json.length -
    JSON.stringify({ status: 'success', ...capped }).length;
  return {
    status: 'success',
    ...capped,
    [TRUNCATED_FIELD]: true,
    [NOTICE_FIELD]: truncationNotice(
      omittedChars,
      lists,
      source.totalFields - Object.keys(capped).length,
      source.totalFields,
    ),
  };
}

// The serialized length rises with `limit` (a larger limit only ever keeps
// more payload, while the notice's own length changes by a few characters as
// the omitted count falls and lists stop being shortened), so the largest
// fitting limit is a binary search — measured against the real serialization
// rather than computed from a budget. Only a fitting candidate is ever
// accepted, so the cap holds even where that rise is not strictly monotone;
// at worst the search settles one step short of the largest fitting limit.
function searchLargestFittingLimit(
  source: TruncationSource,
  keepAllFields: boolean,
): ToolResult {
  let low = 0;
  let high = source.json.length;
  let best = buildTruncatedResult(source, 0, keepAllFields);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = buildTruncatedResult(source, mid, keepAllFields);
    if (JSON.stringify(candidate).length <= RESULT_TRUNCATE_CHARS) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
