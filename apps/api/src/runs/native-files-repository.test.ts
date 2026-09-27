import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from './native-files-repository';
type QueryValue = string | number | null | SQL;
type QueryRows = ReadonlyArray<Readonly<Record<string, QueryValue>>>;
type QueryCall = { method: 'where'; predicate: SQL };

function queryResult(value: QueryRows, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  const where = (predicate: SQL) => {
    calls.push({ method: 'where', predicate });
    return terminal;
  };
  return Object.assign(terminal, {
    from: chain,
    where,
    for: chain,
    limit: chain,
    orderBy: chain,
  });
}

function makeDb(select: Array<QueryRows>) {
  const db: Db = drizzle.mock({ schema });
  const calls: Array<QueryCall> = [];
  const remaining = [...select];
  vi.spyOn(db, 'select').mockImplementation(() => {
    // SAFETY: this test double implements the fluent read surface used by the repository.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return queryResult(remaining.shift() ?? [], calls) as never;
  });
  return { db, calls };
}

describe('NativeFilesRepository delivery fencing', () => {
  it('rejects an omitted delivery sequence even without a started event', async () => {
    const { db } = makeDb([[{ id: 'run-1' }], []]);

    await expect(
      new NativeFilesRepository(db).isCurrentDelivery({
        runId: 'run-1',
        userId: 'owner-1',
        deliverySequence: undefined,
      }),
    ).resolves.toBe(false);
  });

  it('rejects a delivery when the owner-scoped Run lock is missing', async () => {
    const { db } = makeDb([[]]);

    await expect(
      new NativeFilesRepository(db).isCurrentDelivery({
        runId: 'run-1',
        userId: 'owner-1',
        deliverySequence: 7,
      }),
    ).resolves.toBe(false);
  });

  it('locks the Run by owner before checking its latest started sequence', async () => {
    const { db, calls } = makeDb([[{ sequence: 7 }], []]);

    await expect(
      new NativeFilesRepository(db).isCurrentDelivery({
        runId: 'run-1',
        userId: 'owner-1',
        deliverySequence: 7,
      }),
    ).resolves.toBe(false);

    const lockPredicate = calls.find(
      ({ method }) => method === 'where',
    )?.predicate;
    if (lockPredicate === undefined) {
      throw new Error('owner-scoped Run lock predicate was not recorded');
    }
    expect(new PgDialect().sqlToQuery(lockPredicate).sql).toContain(
      '"runs"."user_id" =',
    );
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
