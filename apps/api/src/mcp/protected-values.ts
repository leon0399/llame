import { isRecord } from '../unknown-record';

export const PROTECTED_VALUE_REDACTION_MARKER = '[REDACTED]';

export type ProtectedValueSanitizationResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false; readonly reason: 'protected_value_key' };

/**
 * Removes values that cannot identify a secret and establishes a deterministic
 * replacement order. Whitespace remains significant: a protected value is an
 * exact runtime value, not display text.
 */
export function normalizeProtectedValues(
  values: readonly string[],
): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => {
      const lengthDifference = right.length - left.length;
      if (lengthDifference !== 0) return lengthDifference;
      return left < right ? -1 : left > right ? 1 : 0;
    },
  );
}

function containsProtectedString(
  value: string,
  protectedValues: readonly string[],
): boolean {
  return protectedValues.some((protectedValue) =>
    value.includes(protectedValue),
  );
}

function canonicalJsonScalar(value: unknown): string | undefined {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  return undefined;
}

/**
 * Redacts every protected value inside a single string, longest match first.
 * Exported for the stdio diagnostic path, which redacts plain text rather than
 * a JSON document.
 */
export function redactProtectedString(
  value: string,
  protectedValues: readonly string[],
): string {
  const output: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    let earliestIndex = -1;
    let match = '';

    for (const protectedValue of protectedValues) {
      const index = value.indexOf(protectedValue, cursor);
      if (
        index !== -1 &&
        (earliestIndex === -1 ||
          index < earliestIndex ||
          (index === earliestIndex && protectedValue.length > match.length))
      ) {
        earliestIndex = index;
        match = protectedValue;
      }
    }

    if (earliestIndex === -1) {
      output.push(value.slice(cursor));
      break;
    }

    output.push(
      value.slice(cursor, earliestIndex),
      PROTECTED_VALUE_REDACTION_MARKER,
    );
    cursor = earliestIndex + match.length;
  }

  return output.join('');
}

/**
 * Detects a protected value anywhere in a JSON-like value. Callers use this
 * before executing tool arguments, where redaction would silently alter intent.
 */
export function containsProtectedValueJson(
  value: unknown,
  protectedValues: readonly string[],
): boolean {
  return containsNormalizedProtectedValueJson(
    value,
    normalizeProtectedValues(protectedValues),
  );
}

function containsNormalizedProtectedValueJson(
  value: unknown,
  protectedValues: readonly string[],
): boolean {
  if (typeof value === 'string') {
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
  value: unknown,
  protectedValues: readonly string[],
): ProtectedValueSanitizationResult {
  return sanitizeNormalizedProtectedValueJson(
    value,
    normalizeProtectedValues(protectedValues),
  );
}

function sanitizeNormalizedProtectedValueJson(
  value: unknown,
  protectedValues: readonly string[],
): ProtectedValueSanitizationResult {
  if (typeof value === 'string') {
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
    const safe: unknown[] = [];
    for (const item of value) {
      const result = sanitizeNormalizedProtectedValueJson(
        item,
        protectedValues,
      );
      if (!result.success) return result;
      safe.push(result.value);
    }
    return { success: true, value: safe };
  }

  if (!isRecord(value)) return { success: true, value };

  const safeEntries: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (containsProtectedString(key, protectedValues)) {
      return { success: false, reason: 'protected_value_key' };
    }
    const result = sanitizeNormalizedProtectedValueJson(item, protectedValues);
    if (!result.success) return result;
    safeEntries.push([key, result.value]);
  }
  return { success: true, value: Object.fromEntries(safeEntries) };
}
