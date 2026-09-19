/**
 * The ledger drizzle's migrator consults before it applies anything: it reads
 * the newest `drizzle.__drizzle_migrations` row, then skips every journal entry
 * whose `when` is not newer. A row stored in the wrong unit therefore disables
 * every later migration without an error, so `db:migrate` asserts the newest
 * stamp before it reports success.
 */

/** A row of `drizzle.__drizzle_migrations`: the journal's `when`, as text. */
export type MigrationLedgerRow = {
  hash: string;
  created_at: string | null;
};

/**
 * How far ahead of this process a stamp may sit before it is a unit mix-up
 * rather than clock skew: a developer machine with a fast clock writes a stamp
 * seconds ahead, while nanoseconds where the journal holds milliseconds are
 * decades ahead.
 */
export const LEDGER_STAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Throws when `newest` is stamped more than the tolerance ahead of `now`,
 * naming the row and its stored stamp so the operator can delete or re-stamp
 * it. An empty ledger, a `null` stamp, and a stamp inside the window pass.
 */
export function assertLedgerStampIsUsable(
  newest: MigrationLedgerRow | undefined,
  now: number,
): void {
  if (newest === undefined) {
    return;
  }
  if (
    newest.created_at !== null &&
    Number(newest.created_at) > now + LEDGER_STAMP_TOLERANCE_MS
  ) {
    throw new Error(
      `The newest migration ledger row ("${newest.hash}", created_at=${newest.created_at}) is stamped in the future, ` +
        "so drizzle skipped every pending migration. Ledger rows hold the journal's millisecond `when`; " +
        'delete or re-stamp that row, then rerun.',
    );
  }
}
