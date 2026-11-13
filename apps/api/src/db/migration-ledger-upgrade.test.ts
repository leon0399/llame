import { describe, expect, it, vi } from 'vitest';

import {
  assertNamedLedgerIsSafe,
  convertLegacyLedgerRows,
  KNOWN_LEGACY_MIGRATION_NAMES,
  planLegacyLedgerConversion,
} from './migration-ledger-upgrade';

const localMigrationNames = new Set(KNOWN_LEGACY_MIGRATION_NAMES);

describe('safe legacy migration ledger conversion', () => {
  it('keeps a one-to-one map for every historical converted migration', () => {
    expect(KNOWN_LEGACY_MIGRATION_NAMES).toHaveLength(87);
    expect(new Set(KNOWN_LEGACY_MIGRATION_NAMES).size).toBe(87);
  });

  it('distinguishes the two historical migrations recorded in the same second', () => {
    // Exact journal timestamps from the pre-v1 history, through the collision.
    const timestamps = [
      1_751_224_723_402, 1_751_226_944_554, 1_751_233_460_223,
      1_752_640_526_507, 1_752_700_000_000, 1_782_735_542_694,
      1_782_763_011_177, 1_782_773_757_483, 1_782_776_766_411,
      1_782_949_969_476, 1_783_009_440_418, 1_783_078_013_940,
      1_783_109_328_024, 1_783_109_928_024, 1_783_255_441_287,
      1_783_290_823_804, 1_783_327_535_304, 1_783_337_452_496,
      1_783_352_181_144, 1_783_461_593_945, 1_783_613_237_724,
      1_783_784_477_273, 1_783_800_869_200, 1_783_815_906_676,
      1_783_835_529_417, 1_783_900_957_382, 1_783_953_156_806,
      1_783_986_151_725, 1_784_025_316_453, 1_784_382_140_622,
      1_785_788_118_959, 1_786_204_865_598, 1_786_376_777_038,
      1_786_437_612_626, 1_786_564_546_083, 1_786_568_025_805,
      1_786_610_861_660, 1_786_610_861_661,
    ];

    const rows = timestamps.map((created_at, index) => ({
      id: index + 1,
      hash: 'historical-hash',
      created_at,
    }));

    const result = planLegacyLedgerConversion(rows, localMigrationNames);

    expect(result.slice(-2)).toEqual([
      { id: 37, name: '20260813084741_unique_fallen_one' },
      { id: 38, name: '20260813084742_context_item_cutover' },
    ]);
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
