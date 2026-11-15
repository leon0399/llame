import { describe, expect, it, vi } from 'vitest';

import {
  assertNamedLedgerIsSafe,
  convertLegacyLedgerRows,
  KNOWN_LEGACY_MIGRATION_NAMES,
  planLegacyLedgerConversion,
  type LegacyMigrationRow,
  type NamedMigrationRow,
} from './migration-ledger-upgrade';

// These first two identities are copied literally from the pre-v1 journal,
// independently of the production lookup tables.
const FIRST_LEGACY = {
  millis: 1_751_224_723_402,
  name: '20250629191843_exotic_sleepwalker',
} as const;

const SECOND_LEGACY = {
  millis: 1_751_226_944_554,
  name: '20250629195544_minor_red_ghost',
} as const;

const THIRD_LEGACY_MILLIS = 1_751_233_460_223;
const NEW_MIGRATION = '20261115000108_reconcile_v1_snapshot';

// The production-known names provide only the simulated local folder inventory.
const localNames = new Set([...KNOWN_LEGACY_MIGRATION_NAMES, NEW_MIGRATION]);

function legacyRow(
  id: number,
  created_at: string | number | null,
): LegacyMigrationRow {
  return { id, hash: `hash-${id}`, created_at };
}

function namedRow(
  id: number,
  name: string | null,
  created_at: string | number | null,
  applied_at: string | null = null,
): NamedMigrationRow {
  return { id, hash: `hash-${id}`, name, created_at, applied_at };
}

async function expectConversionRejectedWithoutEffects(
  rows: ReadonlyArray<LegacyMigrationRow>,
  folders: ReadonlySet<string> = localNames,
): Promise<void> {
  const addColumns = vi.fn(() => Promise.resolve());
  const assignNames = vi.fn(() => Promise.resolve());

  await expect(
    convertLegacyLedgerRows(rows, folders, addColumns, assignNames),
  ).rejects.toBeInstanceOf(Error);
  expect(addColumns).not.toHaveBeenCalled();
  expect(assignNames).not.toHaveBeenCalled();
}

describe('migration-ledger safety guards', () => {
  describe('legacy conversion plan', () => {
    it.each([
      ['fractional ID', [legacyRow(1.5, FIRST_LEGACY.millis)]],
      [
        'unsafe integer ID',
        [legacyRow(Number.MAX_SAFE_INTEGER + 1, FIRST_LEGACY.millis)],
      ],
      [
        'duplicate IDs',
        [legacyRow(1, FIRST_LEGACY.millis), legacyRow(1, SECOND_LEGACY.millis)],
      ],
    ])('rejects %s without DDL or row updates', async (_case, rows) => {
      await expectConversionRejectedWithoutEffects(rows);
    });

    it('rejects an unknown millisecond timestamp without side effects', async () => {
      await expectConversionRejectedWithoutEffects([
        legacyRow(1, FIRST_LEGACY.millis + 1),
      ]);
    });

    it('rejects when converted history folders are missing before side effects', async () => {
      const incompleteFolders = new Set(localNames);
      incompleteFolders.delete(SECOND_LEGACY.name);
      await expectConversionRejectedWithoutEffects(
        [legacyRow(1, FIRST_LEGACY.millis)],
        incompleteFolders,
      );
    });

    it.each([
      [
        'a skipped historical migration',
        [legacyRow(1, FIRST_LEGACY.millis), legacyRow(2, THIRD_LEGACY_MILLIS)],
      ],
      [
        'reordered historical rows',
        [legacyRow(1, SECOND_LEGACY.millis), legacyRow(2, FIRST_LEGACY.millis)],
      ],
      [
        'a history that starts after the prefix beginning',
        [legacyRow(1, SECOND_LEGACY.millis)],
      ],
      [
        'a duplicated historical migration',
        [legacyRow(1, FIRST_LEGACY.millis), legacyRow(2, FIRST_LEGACY.millis)],
      ],
    ])('rejects %s without DDL or row updates', async (_case, rows) => {
      await expectConversionRejectedWithoutEffects(rows);
    });

    it('orders a complete prefix by ledger IDs before converting', () => {
      expect(
        planLegacyLedgerConversion(
          [
            legacyRow(2, SECOND_LEGACY.millis),
            legacyRow(1, FIRST_LEGACY.millis),
          ],
          localNames,
        ),
      ).toEqual([
        { id: 1, name: FIRST_LEGACY.name },
        { id: 2, name: SECOND_LEGACY.name },
      ]);
    });
  });

  describe('already-named ledger validation', () => {
    it.each([
      [
        'null name',
        [namedRow(1, null, '1780000000000', '2026-11-15T00:00:00Z')],
      ],
      [
        'unknown name',
        [
          namedRow(
            1,
            'not_a_local_migration',
            '1780000000000',
            '2026-11-15T00:00:00Z',
          ),
        ],
      ],
      [
        'duplicate names',
        [
          namedRow(
            1,
            FIRST_LEGACY.name,
            FIRST_LEGACY.millis,
            '2026-11-15T00:00:00Z',
          ),
          namedRow(
            2,
            FIRST_LEGACY.name,
            FIRST_LEGACY.millis,
            '2026-11-15T00:00:01Z',
          ),
        ],
      ],
    ])('rejects a ledger with a %s name', (_case, rows) => {
      expect(() => assertNamedLedgerIsSafe(rows, localNames)).toThrow(Error);
    });

    it.each([
      [
        'a different known legacy timestamp',
        namedRow(1, FIRST_LEGACY.name, SECOND_LEGACY.millis),
      ],
      [
        'an unknown timestamp',
        namedRow(1, FIRST_LEGACY.name, FIRST_LEGACY.millis + 1),
      ],
    ])('rejects a converted row with %s', (_case, row) => {
      expect(() => assertNamedLedgerIsSafe([row], localNames)).toThrow(Error);
    });
  });
});
