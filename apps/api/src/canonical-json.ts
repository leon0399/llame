import { createHash } from 'node:crypto';

import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

export const compareCodePoints = (left: string, right: string): number => {
  const leftScalars = Array.from(left, (scalar) => scalar.codePointAt(0) ?? 0);
  const rightScalars = Array.from(
    right,
    (scalar) => scalar.codePointAt(0) ?? 0,
  );
  const sharedLength = Math.min(leftScalars.length, rightScalars.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftScalars[index] - rightScalars[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return leftScalars.length - rightScalars.length;
};

/** The JSON-like shape `canonicalize` preserves while sorting object keys. */
export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<CanonicalJsonValue>
  | { [key: string]: CanonicalJsonValue };

export function canonicalize(
  value: UnknownRecord,
): Record<string, CanonicalJsonValue>;
export function canonicalize(value: unknown): CanonicalJsonValue;
export function canonicalize(value: unknown): CanonicalJsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  // The array branch above already returned, so `isRecord`'s own
  // `!Array.isArray` conjunct is a no-op here, not a behavior change.
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  // Numbers, booleans, null, and undefined are already JSON-shaped. Anything
  // else (symbol, function, bigint) is not a shape hashed/compared tool
  // declarations carry — fail closed instead of passing it through.
  if (
    value === null ||
    value === undefined ||
    isString(value) ||
    isNumber(value) ||
    isBoolean(value)
  ) {
    return value;
  }
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- diagnostic interpolation naming the rejected value's runtime type in the thrown message, not narrowing it; no predicate form applies to a value already excluded from every accepted branch above.
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}.`);
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates directly to `canonicalize` above, the actual recursive walker that dispatches on `Array.isArray`/`typeof`; this is a thin `JSON.stringify` wrapper around it, not a second boundary.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashWithDomain(domain: string, payload: string): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(payload, 'utf8')
    .digest('hex');
}
