import { createHash } from 'node:crypto';

import { type UnknownRecord } from './unknown-record';

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
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export function canonicalize(
  value: UnknownRecord,
): Record<string, CanonicalJsonValue>;
export function canonicalize(value: unknown): CanonicalJsonValue;
export function canonicalize(value: unknown): CanonicalJsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
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
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}.`);
}

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
