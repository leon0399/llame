import { cutStringAtCodePointBoundary } from "./code-point-boundary";
import {
  ARTIFACT_NOT_STORED,
  artifactNotice,
  type ArtifactNoticeHostFiles,
} from "./artifact-notice";
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from "./unknown-record";
import { type ToolResult } from "./types";

/** ~16KB result cap (D5/D6): oversized tool output is truncated, visibly. */
export const RESULT_TRUNCATE_CHARS = 16_000;

/**
 * What happened to the artifact of a `head` result (tool-result-artifacts D3,
 * D6): `stored` names the locator the cap notice points at, and `not-stored`
 * marks a rendering that was too large to keep, or a failed write, so the
 * notice carries {@link ARTIFACT_NOT_STORED} and the result carries no field.
 */
export type CappedResultSpill =
  | {
      readonly kind: "stored";
      readonly locator: string;
      /** The artifact's line count, in the reader's 8,000-unit pieces. */
      readonly lineCount: number;
      /** The host files the write also made, when the Run keeps them (D10). */
      readonly hostFiles?: ArtifactNoticeHostFiles;
    }
  | { readonly kind: "not-stored" };

/**
 * The default measure: a result's JSON serialization, in UTF-16 code units.
 * A caller whose model-facing rendering is not that serialization — plain text,
 * a partial projection — passes its own measure, so the cap counts what the
 * model actually receives and a self-bounded result is recorded unchanged.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- measures any JSON-shaped value at the tool-result boundary; `JSON.stringify` itself is the measure, so there is no shape to validate first.
export function measureJson(value: unknown): number {
  return (JSON.stringify(value ?? null) ?? "null").length;
}

/**
 * Marker fields on a truncated result. They are written last, so a payload
 * field of the same name is overwritten: the marker has to sit at a fixed,
 * findable place, and a tool-declared `truncated` would otherwise be
 * indistinguishable from ours.
 */
const TRUNCATED_FIELD = "truncated";
const NOTICE_FIELD = "truncationNotice";

/** A list the shrink shortened, reported by the marker so a count read off a
 * truncated list is not mistaken for the whole list. */
interface ShortenedList {
  readonly path: string;
  readonly kept: number;
  readonly total: number;
}

/** How many shortened lists the marker names before summarizing the rest. */
const NAMED_LIST_LIMIT = 3;

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
        capValues(entry, ctx, path === "" ? key : `${path}.${key}`),
      ],
    ),
  );
}

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
function capValues(value: unknown, ctx: CapContext, path = ""): CappedValue {
  if (isString(value)) {
    return cutStringAtCodePointBoundary(value, ctx.limit);
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, ctx.limit);
    if (kept.length < value.length) {
      ctx.lists.push({
        path: path === "" ? "the result" : path,
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
  if (lists.length === 0) return "";
  const ranked = [...lists].sort(
    (left, right) => right.total - right.kept - (left.total - left.kept),
  );
  const named = ranked
    .slice(0, NAMED_LIST_LIMIT)
    .map((list) => `${list.path} kept ${list.kept} of ${list.total}`)
    .join("; ");
  const remaining = ranked.length - Math.min(ranked.length, NAMED_LIST_LIMIT);
  const more = remaining > 0 ? ` (and ${remaining} more)` : "";
  return ` Lists shortened: ${named}${more}.`;
}

/** Only reachable via the last-resort pass below, where the cap outranks the
 * declared shape. */
function omittedFieldPhrase(
  omittedFields: number,
  totalFields: number,
): string {
  if (omittedFields === 0) return "";
  return ` ${omittedFields} of ${totalFields} result fields omitted entirely.`;
}

interface TruncationNoticeInput {
  readonly omittedUnits: number;
  readonly lists: ReadonlyArray<ShortenedList>;
  readonly omittedFields: number;
  readonly totalFields: number;
  readonly spill: CappedResultSpill | undefined;
}

function truncationNotice(input: TruncationNoticeInput): string {
  const { omittedUnits, lists, omittedFields, totalFields, spill } = input;
  return (
    `Result truncated to fit the ${RESULT_TRUNCATE_CHARS}-character tool-result cap; ` +
    `${omittedUnits} characters omitted.${omittedFieldPhrase(omittedFields, totalFields)}` +
    `${shortenedListPhrase(lists)}${spillPhrase(spill)} ` +
    `Re-run this tool with narrower arguments if you need the omitted content.`
  );
}

/**
 * Where the head result's artifact is: the same bracketed notice a
 * `tool`-shaped spill ends with, continuing from the first artifact line. A
 * rendering that could not be stored says so and leaves the artifact field off
 * the result.
 */
function spillPhrase(spill: CappedResultSpill | undefined): string {
  if (spill === undefined) return "";
  if (spill.kind === "not-stored") return ` ${ARTIFACT_NOT_STORED}`;
  return ` ${artifactNotice(
    [{ locator: spill.locator, lines: spill.lineCount }],
    {
      continueWith: { locator: spill.locator, next: 1 },
      ...(spill.hostFiles !== undefined && { hostFiles: spill.hostFiles }),
    },
  )}`;
}

/**
 * The measure for a result whose `display` was set aside: the default JSON
 * measure counts the serialization the shrink works on, which is display-free,
 * while every other measure counts a rendering, and an edit's rendering reads
 * `display`, so it receives the full candidate.
 */
function displayAwareMeasure(
  measure: (candidate: ToolResult) => number,
  display: UnknownRecord,
): (candidate: ToolResult) => number {
  if (measure === measureJson) return measure;
  return (candidate) =>
    candidate.status === "success"
      ? measure({ ...candidate, display })
      : measure(candidate);
}

/**
 * A result with its `display` data split off, and the measure that sees it. A
 * display-carrying result is never serialized with its display into the capped
 * result, so both the predicate and the cut read the display-free form while
 * the caller's measure still counts the rendering display builds.
 */
type DisplaySplit =
  | {
      readonly split: false;
      readonly shown: ToolResult;
      readonly measure: (candidate: ToolResult) => number;
    }
  | {
      readonly split: true;
      readonly shown: ToolResult;
      readonly measure: (candidate: ToolResult) => number;
      readonly display: unknown;
    };

function splitDisplay(
  result: ToolResult,
  measure: (candidate: ToolResult) => number,
): DisplaySplit {
  if (result.status !== "success" || !Object.hasOwn(result, "display")) {
    return { split: false, shown: result, measure };
  }
  const { display, ...shown } = result;
  return {
    split: true,
    shown,
    display,
    measure: isRecord(display)
      ? displayAwareMeasure(measure, display)
      : measure,
  };
}

/**
 * Whether the cap would shorten this result. The predicate shares
 * {@link splitDisplay} with the truncation, so a caller that stores the whole
 * rendering first (a `head` spill) never writes an artifact for a result that
 * fits.
 */
export function isOversizedResult(
  result: ToolResult,
  measure: (candidate: ToolResult) => number = measureJson,
): boolean {
  if (result.status !== "success") return false;
  const split = splitDisplay(result, measure);
  return split.measure(split.shown) > RESULT_TRUNCATE_CHARS;
}

/**
 * Truncate an oversized SUCCESS result to the cap, keeping the shape the tool
 * declared (#294). The `status` discriminant and every top-level field survive
 * with their values shrunk in place; the model never receives a fragment of
 * the result's own serialization in place of the result.
 *
 * The cap is measured with `measure`, which the caller supplies when its
 * model-facing rendering is not the result's JSON — a text rendering rather
 * than a JSON one — so the cap counts what the model receives.
 *
 * A result's `display` data never reaches the model as raw characters, so it
 * is not serialized into the capped result and is never shortened: it is set
 * aside and kept unchanged (tool-result-rendering D2). A text rendering may
 * still be built from it — an edit's header names the line its `display`
 * starts at and the counts it replaced — so a caller's `measure` sees the
 * candidate with `display` re-attached.
 *
 * `spill` is the artifact a `head` result was stored as, if any; the notice
 * names it, and the artifact field is already pinned on `result`.
 *
 * Error results are never truncated — every error message this registry
 * produces is a short, statically-authored string (see refusalResult /
 * invalidCallResult and the runner's catch branches), so an oversized error
 * can only mean a bug elsewhere, not something to silently cap here.
 */
export function truncateOversizedResult(
  result: ToolResult,
  measure: (candidate: ToolResult) => number = measureJson,
  spill?: CappedResultSpill,
): ToolResult {
  if (result.status !== "success") return result;
  const split = splitDisplay(result, measure);
  if (split.split) {
    const capped = truncateOversizedResult(split.shown, split.measure, spill);
    return capped.status === "success"
      ? { ...capped, display: split.display }
      : capped;
  }
  const measured = measure(result);
  if (measured <= RESULT_TRUNCATE_CHARS) return result;
  const json = JSON.stringify(result) ?? "null";

  // Work on the result's own JSON projection: `JSON.stringify` has already
  // applied `toJSON`, dropped undefined, and fixed every length, so what is
  // measured below is exactly what the model receives.
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || parsed.status !== "success") {
    throw new TypeError("Malformed oversized tool result projection.");
  }
  const { status: _status, ...payload } = parsed;
  const source: TruncationSource = {
    payload,
    pinned: pinnedFields(payload),
    totalFields: Object.keys(payload).length,
    json,
    measured,
    measure,
    spill,
  };

  // First pass keeps every top-level field, which is the shape guarantee. Its
  // floor is not free: a payload of thousands of top-level keys exceeds the cap
  // on the key names alone, with every value already emptied. The cap outranks
  // the shape there — an unbounded result is the thing the cap exists to keep
  // out of a provider request — so a second pass drops trailing fields too, and
  // the marker says how many. That pass always fits: its own floor is the
  // marker alone.
  const preserved = searchLargestFittingLimit(source, true);
  return measure(preserved) <= RESULT_TRUNCATE_CHARS
    ? preserved
    : searchLargestFittingLimit(source, false);
}

/**
 * The fields a truncation pass keeps verbatim: a media part's locator and a
 * spilled result's artifact locator are the only handles on content this
 * result no longer carries, so the capped copy never replaces them. A value of
 * the wrong type is not a locator and is capped with everything else.
 */
function pinnedFields(payload: UnknownRecord): UnknownRecord {
  const pinned: UnknownRecord = {};
  const pinsMedia =
    (payload.kind === "image" || payload.kind === "pdf") &&
    isString(payload.media);
  if (pinsMedia) pinned.media = payload.media;
  if (isArtifactLocatorValue(payload.artifact)) {
    pinned.artifact = payload.artifact;
  }
  return pinned;
}

/**
 * The artifact locator grammar, bounded. This package cannot import the API's
 * locator parser, so the shared check repeats the one token shape and caps the
 * length: a result field that merely calls itself `artifact` must not escape
 * the cap, and a real locator is far below the bound.
 */
const ARTIFACT_LOCATOR =
  /^artifact:\/\/[A-Za-z0-9][A-Za-z0-9_-]*-[1-9]\d*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)?$/u;
const ARTIFACT_LOCATOR_MAX_LENGTH = 512;

function isArtifactLocatorValue(value: unknown): value is string {
  return (
    isString(value) &&
    value.length <= ARTIFACT_LOCATOR_MAX_LENGTH &&
    ARTIFACT_LOCATOR.test(value)
  );
}

/** The part of a truncation pass that never changes across the binary
 * search's candidate limits. */
interface TruncationSource {
  readonly payload: UnknownRecord;
  /** Fields kept verbatim before the capped payload. */
  readonly pinned: UnknownRecord;
  readonly totalFields: number;
  readonly json: string;
  /** The original result's measured size, in measured units. */
  readonly measured: number;
  /** The caller's measure: what the model reads, in its own units. */
  readonly measure: (candidate: ToolResult) => number;
  /** The artifact this result was stored as, when it spilled. */
  readonly spill: CappedResultSpill | undefined;
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
    "",
  );
  const kept = { ...capped, ...source.pinned };
  const omittedUnits =
    source.measured - source.measure({ status: "success", ...kept });
  return {
    status: "success",
    ...kept,
    [TRUNCATED_FIELD]: true,
    [NOTICE_FIELD]: truncationNotice({
      omittedUnits,
      lists,
      omittedFields: source.totalFields - Object.keys(kept).length,
      totalFields: source.totalFields,
      spill: source.spill,
    }),
  };
}

// The measured length rises with `limit` (a larger limit only ever keeps
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
    if (source.measure(candidate) <= RESULT_TRUNCATE_CHARS) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
