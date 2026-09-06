import { isRecord, isString } from '@workspace/runtime-safety';

/**
 * Extracts the Postgres SQLSTATE from a raw driver error or a Drizzle
 * wrapper — Drizzle nests the postgres.js error on `.cause`, so the code
 * can surface either directly or one level down.
 */
export function pgErrorCode(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  if (isString(err['code'])) return err['code'];
  return isRecord(err['cause']) && isString(err['cause']['code'])
    ? err['cause']['code']
    : undefined;
}
