import { describe, expect, it } from 'vitest';

import {
  assertLedgerStampIsUsable,
  LEDGER_STAMP_TOLERANCE_MS,
  type MigrationLedgerRow,
} from './migration-ledger';

const NOW = 1_789_000_000_000;
const A_DAY_MS = 86_400_000;

function row(
  hash: string,
  created_at: MigrationLedgerRow['created_at'],
): MigrationLedgerRow {
  return { hash, created_at };
}

describe('assertLedgerStampIsUsable', () => {
  it('passes an empty ledger and a row without a stamp', () => {
    expect(() => assertLedgerStampIsUsable(undefined, NOW)).not.toThrow();
    expect(() => assertLedgerStampIsUsable(row('m1', null), NOW)).not.toThrow();
  });

  it('tolerates one day of clock skew, and rejects one millisecond past it', () => {
    expect(LEDGER_STAMP_TOLERANCE_MS).toBe(A_DAY_MS);

    expect(() =>
      assertLedgerStampIsUsable(row('m1', String(NOW + A_DAY_MS)), NOW),
    ).not.toThrow();
    expect(() =>
      assertLedgerStampIsUsable(row('m1', String(NOW + A_DAY_MS + 1)), NOW),
    ).toThrow(/stamped in the future/u);
  });

  it('rejects a nanosecond-scaled stamp, naming the row and the stored value so the operator can repair it', () => {
    const nanosecondStamp = '1789327485929566752';
    expect(() =>
      assertLedgerStampIsUsable(row('manual-repair', nanosecondStamp), NOW),
    ).toThrow(
      /manual-repair[\s\S]*1789327485929566752[\s\S]*skipped every pending migration[\s\S]*re-stamp/u,
    );
  });
});
