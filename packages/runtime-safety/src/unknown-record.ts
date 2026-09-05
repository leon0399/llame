/**
 * A dictionary narrowed from `unknown` at a parsing boundary, not yet
 * validated against an owner/schema-derived shape. Consolidates the
 * project's one sanctioned `Record<string, unknown>` idiom so it is
 * declared once, not repeated ad hoc; do not use it for a shape that is
 * actually known — reach for the real type instead. THIS declaration is the
 * boundary anti-slop/no-unsafe-dictionary-type exists to centralize: every
 * other file imports this alias instead of writing `Record<string,
 * unknown>` locally, and the rule's own alias-consumption exemption lets
 * every one of those imports go clean. Only the origin can never satisfy
 * the rule — the disable below is structural, not a workaround.
 */
// eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the one owned declaration this rule's escape hatch is designed to centralize; every consumer imports this alias instead of writing `Record<string, unknown>` locally (see the doc comment above).
export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Primitive type-guards for narrowing an `unknown` value at its boundary.
 * Consolidating the runtime `typeof` check inside a real type predicate is
 * the pattern `anti-slop/no-runtime-typeof`'s `allowInTypeGuards` option is
 * designed to reward: the check itself is unchanged, but it now establishes
 * a named contract instead of a bare inline comparison scattered ad hoc.
 */
export const isString = (value: unknown): value is string =>
  typeof value === 'string';

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number';

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';
