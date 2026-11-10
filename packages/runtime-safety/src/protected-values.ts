import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from "./unknown-record";

export const PROTECTED_VALUE_REDACTION_MARKER = "[REDACTED]";

export type ProtectedValueSanitizationResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false; readonly reason: "protected_value_key" };

/**
 * Removes values that cannot identify a secret and establishes a deterministic
 * replacement order. Whitespace remains significant: a protected value is an
 * exact runtime value, not display text.
 */
export function normalizeProtectedValues(
  values: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => {
      const lengthDifference = right.length - left.length;

      if (lengthDifference !== 0) return lengthDifference;

      return left < right ? -1 : left > right ? 1 : 0;
    },
  );
}

const CREDENTIAL_HEADER_NAMES = {
  authorization: true,
  "proxy-authorization": true,
  cookie: true,
} as const;

/**
 * The values of the configured headers whose name means the value is a
 * credential, whether written literally or interpolated. Other literal header
 * values are not secrets: protecting a value such as `true` would redact every
 * occurrence of it from tool traffic. The value is trimmed as the HTTP
 * runtime sends it; the trimmed text is a substring of the configured text, so
 * both spellings are covered.
 */
export function credentialHeaderValues(
  headers: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  return Object.entries(headers)
    .filter(([name]) =>
      Object.hasOwn(CREDENTIAL_HEADER_NAMES, name.toLowerCase()),
    )
    .map(([, value]) => value.trim())
    .filter((value) => value.length > 0);
}

function containsProtectedString(
  value: string,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return protectedValues.some((protectedValue) =>
    value.includes(protectedValue),
  );
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `value === null || isBoolean(value)` below -- two checks combined with `||`, a shape the structural exemption's single-check parse doesn't cover; this scalar-classification helper is one branch of the recursive JSON walker below.
function canonicalJsonScalar(value: unknown): string | undefined {
  if (value === null || isBoolean(value)) {
    return JSON.stringify(value);
  }

  if (isNumber(value) && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  return undefined;
}

/** One half-open code-unit range a protected value occupies in a string. */
export type ProtectedValueInterval = {
  readonly start: number;
  readonly end: number;
};

/**
 * Every protected value occurrence in a string as merged raw code-unit
 * intervals, sorted: overlapping and adjacent intervals join, so a replacement
 * leaves no tail of either value. Values are expected normalized (as
 * {@link normalizeProtectedValues} returns them); empty values are skipped
 * defensively.
 */
export function protectedValueIntervals(
  value: string,
  protectedValues: ReadonlyArray<string>,
): ReadonlyArray<ProtectedValueInterval> {
  // One member's occurrences arrive in start order, so its overlapping or
  // adjacent runs coalesce as they are found. Only completed runs join the
  // cross-member list; a single-character member over a long repeated capture
  // therefore stays one interval instead of one per occurrence.
  const matches: Array<ProtectedValueInterval> = [];

  for (const protectedValue of protectedValues) {
    if (protectedValue.length === 0) continue;
    collectMemberIntervals(value, protectedValue, matches);
  }

  if (matches.length === 0) return [];

  matches.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  return mergeIntervals(matches);
}

/**
 * Coalesce one member's start-ordered occurrences into completed runs. Only a
 * new run allocates; adjacent or overlapping occurrences extend the pending
 * one, so a repeated single-character member stays one interval.
 */
function collectMemberIntervals(
  value: string,
  protectedValue: string,
  completed: Array<ProtectedValueInterval>,
): void {
  let pendingStart = -1;
  let pendingEnd = -1;
  let index = value.indexOf(protectedValue);

  while (index !== -1) {
    const end = index + protectedValue.length;

    if (pendingStart === -1) {
      pendingStart = index;
      pendingEnd = end;
    } else if (index <= pendingEnd) {
      pendingEnd = Math.max(pendingEnd, end);
    } else {
      completed.push({ start: pendingStart, end: pendingEnd });
      pendingStart = index;
      pendingEnd = end;
    }

    index = value.indexOf(protectedValue, index + 1);
  }

  if (pendingStart !== -1) {
    completed.push({ start: pendingStart, end: pendingEnd });
  }
}

function mergeIntervals(
  sorted: ReadonlyArray<ProtectedValueInterval>,
): ReadonlyArray<ProtectedValueInterval> {
  const merged: Array<ProtectedValueInterval> = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (previous !== undefined && interval.start <= previous.end) {
      if (interval.end > previous.end) {
        merged[merged.length - 1] = {
          start: previous.start,
          end: interval.end,
        };
      }

      continue;
    }

    merged.push(interval);
  }

  return merged;
}

/**
 * Redacts every protected value inside a single string through the merged
 * intervals, so overlapping members leave no tail. Exported for the stdio
 * diagnostic path, which redacts plain text rather than a JSON document.
 */
export function redactProtectedString(
  value: string,
  protectedValues: ReadonlyArray<string>,
): string {
  const intervals = protectedValueIntervals(value, protectedValues);

  if (intervals.length === 0) return value;

  const output: Array<string> = [];
  let cursor = 0;

  for (const interval of intervals) {
    output.push(
      value.slice(cursor, interval.start),
      PROTECTED_VALUE_REDACTION_MARKER,
    );
    cursor = interval.end;
  }

  output.push(value.slice(cursor));

  return output.join("");
}

/**
 * Detects a protected value anywhere in a JSON-like value. Callers use this
 * before executing tool arguments, where redaction would silently alter intent.
 */
export function containsProtectedValueJson(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- thin public wrapper delegating straight into `containsNormalizedProtectedValueJson` below (which validates via `typeof value === 'string'` as its own first use); this function's first use is a bare-identifier delegation call, not itself a validating check.
  value: unknown,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return containsNormalizedProtectedValueJson(
    value,
    normalizeProtectedValues(protectedValues),
  );
}

function containsNormalizedProtectedValueJson(
  value: unknown,
  protectedValues: ReadonlyArray<string>,
): boolean {
  if (isString(value)) {
    return containsProtectedString(value, protectedValues);
  }

  const scalar = canonicalJsonScalar(value);

  if (scalar !== undefined) return protectedValues.includes(scalar);

  if (Array.isArray(value)) {
    return value.some((item) =>
      containsNormalizedProtectedValueJson(item, protectedValues),
    );
  }

  if (!isRecord(value)) return false;

  return Object.entries(value).some(
    ([key, item]) =>
      containsProtectedString(key, protectedValues) ||
      containsNormalizedProtectedValueJson(item, protectedValues),
  );
}

/**
 * Returns a JSON-like value safe for persistence, diagnostics, or tool output.
 * A protected object key cannot be redacted without changing its meaning, so it
 * fails closed and deliberately returns no key or payload.
 */
export function sanitizeProtectedValueJson(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- thin public wrapper delegating straight into `sanitizeNormalizedProtectedValueJson` below (which validates via `typeof value === 'string'` as its own first use); this function's first use is a bare-identifier delegation call, not itself a validating check.
  value: unknown,
  protectedValues: ReadonlyArray<string>,
): ProtectedValueSanitizationResult {
  return sanitizeNormalizedProtectedValueJson(
    value,
    normalizeProtectedValues(protectedValues),
  );
}

function sanitizeNormalizedProtectedValueJson(
  value: unknown,
  protectedValues: ReadonlyArray<string>,
): ProtectedValueSanitizationResult {
  if (isString(value)) {
    return {
      success: true,
      value: redactProtectedString(value, protectedValues),
    };
  }

  const scalar = canonicalJsonScalar(value);

  if (scalar !== undefined) {
    return {
      success: true,
      value: protectedValues.includes(scalar)
        ? PROTECTED_VALUE_REDACTION_MARKER
        : value,
    };
  }

  if (Array.isArray(value)) {
    return sanitizeProtectedValueArray(value, protectedValues);
  }

  if (!isRecord(value)) return { success: true, value };

  return sanitizeProtectedValueRecord(value, protectedValues);
}

function sanitizeProtectedValueArray(
  value: Array<unknown>,
  protectedValues: ReadonlyArray<string>,
): ProtectedValueSanitizationResult {
  const safe: Array<unknown> = [];

  for (const item of value) {
    const result = sanitizeNormalizedProtectedValueJson(item, protectedValues);

    if (!result.success) return result;
    safe.push(result.value);
  }

  return { success: true, value: safe };
}

/** A protected object KEY cannot be redacted without changing the object's
 *  meaning, so its presence fails the whole record closed. */
function sanitizeProtectedValueRecord(
  value: UnknownRecord,
  protectedValues: ReadonlyArray<string>,
): ProtectedValueSanitizationResult {
  const safeEntries: Array<[string, unknown]> = [];

  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedString(key, protectedValues)) {
      return { success: false, reason: "protected_value_key" };
    }

    const result = sanitizeNormalizedProtectedValueJson(item, protectedValues);

    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }

  return { success: true, value: Object.fromEntries(safeEntries) };
}
