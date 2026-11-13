import { describe, expect, it, vi } from 'vitest';

import {
  assertNamedLedgerIsSafe,
  convertLegacyLedgerRows,
  KNOWN_LEGACY_MIGRATION_NAMES,
} from './migration-ledger-upgrade';

const localMigrationNames = new Set(KNOWN_LEGACY_MIGRATION_NAMES);

describe('safe legacy migration ledger conversion', () => {
  it('keeps a one-to-one map for every historical converted migration', () => {
    expect(KNOWN_LEGACY_MIGRATION_NAMES).toHaveLength(87);
    expect(new Set(KNOWN_LEGACY_MIGRATION_NAMES).size).toBe(87);
  });

  it('fails before any DDL or row update when an old row has no exact historical identity', async () => {
    const addColumns = vi.fn(() => Promise.resolve());
    const assignNames = vi.fn(() => Promise.resolve());

    await expect(
      convertLegacyLedgerRows(
        [{ id: 1, hash: 'unknown', created_at: '1786610861000' }],
        localMigrationNames,
        addColumns,
        assignNames,
      ),
    ).rejects.toThrow(/does not identify one exact historical migration/);

    expect(addColumns).not.toHaveBeenCalled();
    expect(assignNames).not.toHaveBeenCalled();
  });

  it('accepts a valid partial pre-upgrade history without guessing later migrations', async () => {
    const converted: Array<{ id: number; name: string }> = [];

    await convertLegacyLedgerRows(
      [
        { id: 1, hash: 'historical-hash', created_at: '1751224723402' },
        { id: 2, hash: 'another-historical-hash', created_at: '1751226944554' },
      ],
      localMigrationNames,
      () => Promise.resolve(),
      (rows) => {
        converted.push(...rows);

        return Promise.resolve();
      },
    );

    expect(converted).toEqual([
      { id: 1, name: '20250629191843_exotic_sleepwalker' },
      { id: 2, name: '20250629195544_minor_red_ghost' },
    ]);
  });

  it('rejects an already-v1 ledger with duplicate migration identities before migrations run', () => {
    expect(() =>
      assertNamedLedgerIsSafe(
        [
          {
            id: 36,
            hash: 'hash-36',
            created_at: '1786610861660',
            name: '20260813084741_unique_fallen_one',
            applied_at: null,
          },
          {
            id: 37,
            hash: 'hash-37',
            created_at: '1786610861661',
            name: '20260813084741_unique_fallen_one',
            applied_at: null,
          },
        ],
        localMigrationNames,
      ),
    ).toThrow(/missing, unknown, or duplicate migration name/);
  });
});
