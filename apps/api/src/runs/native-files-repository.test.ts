import { type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from './native-files-repository';

type QueryValue = string | number | null | SQL;
type QueryRows = ReadonlyArray<Readonly<Record<string, QueryValue>>>;

function queryResult(value: QueryRows) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    for: chain,
    limit: chain,
    orderBy: chain,
  });
}

function makeDb(select: Array<QueryRows>) {
  const db: Db = drizzle.mock({ schema });
  const remaining = [...select];
  vi.spyOn(db, 'select').mockImplementation(() => {
    // SAFETY: this test double implements the fluent read surface used by the repository.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return queryResult(remaining.shift() ?? []) as never;
  });
  return db;
}

describe('NativeFilesRepository delivery fencing', () => {
  it('rejects an omitted delivery sequence even without a started event', async () => {
    const db = makeDb([[{ id: 'run-1' }], []]);

    await expect(
      new NativeFilesRepository(db).isCurrentDelivery({
        runId: 'run-1',
        userId: 'owner-1',
        deliverySequence: undefined,
      }),
    ).resolves.toBe(false);
  });

  it('rejects a delivery when the owner-scoped Run lock is missing', async () => {
    const db = makeDb([[]]);

    await expect(
      new NativeFilesRepository(db).isCurrentDelivery({
        runId: 'run-1',
        userId: 'owner-1',
        deliverySequence: 7,
      }),
    ).resolves.toBe(false);
  });

  it('returns executor_unavailable before any native operation for a stale delivery', async () => {
    const db: Db = drizzle.mock({ schema });
    const repository = new NativeFilesRepository(db);
    vi.spyOn(repository, 'isCurrentDelivery').mockResolvedValue(false);

    await expect(
      repository.begin({
        runId: 'run-1',
        userId: 'owner-1',
        fence: { bound: false },
        deliverySequence: 7,
        toolCallId: 'call-1',
        operation: 'read',
        path: '/tmp/file',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
  });
});
