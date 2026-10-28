/**
 * An error's text with no query bind values.
 *
 * Drizzle wraps every failed statement in `DrizzleQueryError`, whose message
 * is `Failed query: <statement>\nparams: <every bind value>`. Retained read
 * media travels as a bind value (`media-attachments`: no retained byte crosses
 * a log or a client response), so a failed `messages` or `run_events` write
 * would print megabytes of the owner's file. These keep the parts that explain
 * the failure — the statement, and the driver's own error for a log — and drop
 * the params line.
 */
import { DrizzleQueryError } from 'drizzle-orm';

/**
 * `error`'s own message for a reader outside the server — a Run's stored error,
 * which the owner reads — with the same rule: a failed query reports its
 * statement, never the bind values.
 */
export function errorMessageWithoutParams(error: unknown): string {
  if (error instanceof DrizzleQueryError) return `Failed query: ${error.query}`;
  return error instanceof Error ? error.message : String(error);
}

/** `error` as a log line: its stack, or a failed query's statement and cause. */
export function loggableError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const statement = `Failed query: ${error.query}`;
    return error.cause === undefined
      ? statement
      : `${statement}\n${loggableError(error.cause)}`;
  }
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
