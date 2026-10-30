import { isRecord, isString, type UnknownRecord } from "./unknown-record";

/*
 * One neutralizer for tool-result payloads: the **reserved-name rule**, and
 * nothing else (tool-result-rendering "Tool result payloads are neutralized by
 * the reserved-name rule").
 *
 * A tag-shaped token that names a reserved delimiter — opener or closer,
 * matched or not, in any case or spacing — is angle-escaped as a whole. Every
 * other character passes byte-for-byte: source markup a result carries (`</div>`
 * with no opener in the window) is the content the model asked for, and
 * escaping it would corrupt the read.
 *
 * This is rule 2 of `instance-config`'s authored-text sanitizer, which also
 * applies rule 1 (a value may never close a tag it did not open). Rule 1 is
 * deliberately absent here: it rewrites unrelated closers such as `</div>`,
 * which a tool result legitimately carries.
 */

/**
 * Tag names no tool-result payload may ever emit as a tag. These are the
 * packaged fences and server-authored structural labels of `instance-config`:
 * a result that spells one is either forging that framing or echoing it, and
 * either way must not reach the model as a tag.
 */
export const RESERVED_DELIMITER_NAMES: ReadonlySet<string> = new Set([
  "system-reminder",
  "tool-call",
  "tool-result",
  "user_chat_history",
  "user_personalization",
  "skill",
  "available_skills",
]);

/**
 * Any tag-SHAPED token naming a reserved delimiter, however sloppily spelled:
 * `<tool-result>`, `< tool-result>`, `</tool-result>`, `</TOOL-RESULT >`, or an
 * unterminated `<tool-result foo="`.
 *
 * Reservation must not depend on the token parsing cleanly. A padded or
 * unterminated spelling is still a name a model can read as that delimiter, so
 * the name is taken from the token's opening shape alone.
 */
const RESERVED_INTENT = /^<\s*(?:\/\s*)?([A-Za-z][\w.:-]*)/u;

/**
 * One markup-ish token: it runs to the next `>`, or stops before the next `<`
 * or at the end of the text when it is unterminated.
 */
export interface TagToken {
  /** Index of the opening `<`. */
  readonly start: number;
  /** Index just past the token. */
  readonly end: number;
  /** The token's own characters, `text.slice(start, end)`. */
  readonly token: string;
}

/**
 * Every tag-shaped token of `text`, left to right, non-overlapping. A scan
 * rather than a pattern: the same walk expressed as `/<[^<>]*>?/gu` reads as
 * polynomial to a static analyser on a result's uncontrolled text, and the
 * index walk states the one rule directly — from a `<`, take characters until
 * the next `>` (included) or the next `<` or the end (excluded).
 */
export function* scanTagTokens(text: string): Generator<TagToken> {
  let index = text.indexOf("<");
  while (index !== -1) {
    const closer = text.indexOf(">", index + 1);
    const opener = text.indexOf("<", index + 1);
    const end =
      opener !== -1 && (closer === -1 || opener < closer)
        ? opener
        : closer === -1
          ? text.length
          : closer + 1;
    yield { start: index, end, token: text.slice(index, end) };
    index = text.indexOf("<", end);
  }
}

export function escapeAngles(token: string): string {
  return token.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Whether one tag-shaped token names a reserved delimiter, however it is
 *  spelled. */
export function isReservedDelimiterToken(token: string): boolean {
  const name = RESERVED_INTENT.exec(token)?.[1];
  return name !== undefined && RESERVED_DELIMITER_NAMES.has(name.toLowerCase());
}

/**
 * Escape every tag-shaped token naming a reserved delimiter, and change
 * nothing else. A rendering passes through this once, as a whole when it is
 * text and value by value when it is JSON.
 */
export function neutralizeReservedDelimiters(text: string): string {
  let out = "";
  let cursor = 0;
  for (const { start, end, token } of scanTagTokens(text)) {
    if (!isReservedDelimiterToken(token)) continue;
    out += text.slice(cursor, start) + escapeAngles(token);
    cursor = end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/**
 * Whether the deep walk above would LOSE a member of `value`: an object may
 * hold both a key and that key's escaped spelling (`{"<skill>": a,
 * "&lt;skill&gt;": b}`), and after escaping both are the same key, so
 * `Object.fromEntries` keeps only the later value.
 *
 * A caller that finds a collision must not render this value as JSON value by
 * value; escaping the serialized JSON as one text cannot collide.
 */
export function hasEscapedKeyCollision(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasEscapedKeyCollision);
  if (!isRecord(value) || !isPlainObject(value)) return false;
  const keys = Object.keys(value);
  for (const key of keys) {
    const escaped = neutralizeReservedDelimiters(key);
    if (escaped !== key && keys.includes(escaped)) return true;
  }
  return Object.values(value).some(hasEscapedKeyCollision);
}

/**
 * Apply the reserved-name rule to every object key and string value of a
 * JSON-shaped result, recursively, leaving numbers, booleans, and null alone.
 */
export function neutralizeReservedDelimitersDeep<T>(value: T): T {
  // SAFETY: the walk rebuilds the input's own JSON shape — a string stays a
  // string, an array an array of walked elements, a record a record of walked
  // keys and values — so the rebuilt value has its input's type; only character
  // content changes.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript cannot express "the same shape" for an unconstrained T; the walk above guarantees it structurally, and every caller holds a JSON-shaped tool result.
  return neutralizeValue(value) as T;
}

/**
 * A plain object — a JSON object, not a `Date` or a class instance. Only those
 * are rebuilt: copying an object with a prototype would drop its `toJSON`, and
 * the serializer must keep stringifying such a value the way it always has.
 */
function isPlainObject(value: UnknownRecord): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** One value inside the deep walk: strings and keys carry the rule, containers
 *  are walked, and every other value passes through. */
// eslint-disable-next-line anti-slop/no-unknown-returns -- a pass-through walk's output is its input's shape, which no annotation can state: unknown in, unknown out, with the exported generic restoring the caller's type.
function neutralizeValue(value: unknown): unknown {
  if (isString(value)) return neutralizeReservedDelimiters(value);
  if (Array.isArray(value)) {
    return value.map((entry) => neutralizeValue(entry));
  }
  if (isRecord(value) && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        neutralizeReservedDelimiters(key),
        neutralizeValue(entry),
      ]),
    );
  }
  return value;
}
