import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards `meta/_journal.json` against the two silent failure modes of
 * drizzle-orm's migrator, which applies an entry only when its `when` is
 * greater than the newest `created_at` already recorded in
 * `__drizzle_migrations` (drizzle-orm `pg-core/dialect` `migrate`):
 *
 * - a bad journal merge (parallel branches both appending) can leave `idx`
 *   gaps or duplicates;
 * - an entry whose `when` is older than an already-applied sibling is NEVER
 *   applied on existing databases — no error, just skipped. That is exactly
 *   the shape a rebase produces when master gained a newer migration first:
 *   regenerate (or re-stamp) yours so its `when` is newest before merging.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(join(__dirname, 'migrations', 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

describe('migration journal', () => {
  it('has at least one entry', () => {
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it('has contiguous idx values starting at 0', () => {
    const violations = journal.entries
      .filter((entry, i) => entry.idx !== i)
      .map((entry) => `${entry.tag} (idx=${entry.idx})`);
    expect(violations).toEqual([]);
  });

  it('has strictly increasing `when` timestamps (an out-of-order entry is silently skipped on existing databases)', () => {
    const violations = journal.entries
      .slice(1)
      .filter((entry, i) => entry.when <= journal.entries[i].when)
      .map(
        (entry) =>
          `${entry.tag} (when=${entry.when}) is not newer than its predecessor`,
      );
    expect(violations).toEqual([]);
  });
});
