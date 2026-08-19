/**
 * A dictionary narrowed from `unknown` at a parsing boundary, not yet
 * validated against an owner/schema-derived shape. Consolidates the
 * project's one sanctioned `Record<string, unknown>` idiom so it is
 * declared once, not repeated ad hoc; do not use it for a shape that is
 * actually known — reach for the real type instead.
 */
export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
