import { isString, type UnknownRecord } from '@workspace/runtime-safety';

/**
 * True for any non-null `object` — deliberately NOT `isRecord`, which also
 * excludes arrays: an `Error.cause` chain walk must keep visiting a
 * pathological array-shaped cause exactly as it does today, not stop early.
 */
function isCauseChainLink(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

/**
 * Postgres unique_violation on the per-chat single-flight partial index.
 * Walks the cause chain — drizzle wraps the postgres.js error.
 */
export function isInflightUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    isCauseChainLink(current);
    current = current['cause']
  ) {
    const mentionsIndex =
      (isString(current['constraint_name']) &&
        current['constraint_name'].includes('runs_chat_inflight_unique')) ||
      (isString(current['message']) &&
        current['message'].includes('runs_chat_inflight_unique'));
    if (current['code'] === '23505' && mentionsIndex) {
      return true;
    }
  }
  return false;
}
