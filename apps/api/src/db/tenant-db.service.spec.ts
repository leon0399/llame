/**
 * TenantDbService unit tests.
 *
 * Proves that runAs:
 *  1. opens a transaction
 *  2. issues set_config('app.current_user_id', <userId>, true) as the first
 *     statement inside that transaction
 *  3. delegates to the caller-supplied callback with the tx handle
 *  4. returns the callback's result
 *
 * Uses a spy/mock fake db — no real Postgres connection required.
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { PgDialect } from 'drizzle-orm/pg-core';
import { TenantDbService, type Db } from './tenant-db.service';

function makeFakeDb() {
  const executeSpy = jest.fn().mockResolvedValue([]);

  const fakeTx = {
    execute: executeSpy,
  } as unknown as Db;

  const transactionSpy = jest.fn((fn: (tx: Db) => Promise<unknown>) =>
    fn(fakeTx),
  );

  const db = {
    transaction: transactionSpy,
  } as unknown as Db;

  return { db, fakeTx, executeSpy, transactionSpy };
}

describe('TenantDbService.runAs', () => {
  const userId = 'user-abc-123';

  it('opens a transaction', async () => {
    const { db, transactionSpy } = makeFakeDb();
    const svc = new TenantDbService(db);

    await svc.runAs(userId, () => Promise.resolve(undefined));

    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('calls set_config(app.current_user_id, userId, true) — key, value, and is_local all correct', async () => {
    const { db, executeSpy } = makeFakeDb();
    const svc = new TenantDbService(db);

    await svc.runAs(userId, () => Promise.resolve(undefined));

    expect(executeSpy).toHaveBeenCalledTimes(1);

    // Compile the executed statement to SQL + params via the real dialect, so the
    // assertion fails if the config KEY changes or is_local is flipped to false —
    // not just if the userId happens to appear somewhere.
    const dialect = new PgDialect();
    const { sql: compiled, params } = dialect.sqlToQuery(
      executeSpy.mock.calls[0][0] as never,
    );

    expect(compiled).toContain('set_config');
    expect(compiled).toContain('app.current_user_id');
    expect(compiled).toContain('true'); // is_local = true (transaction-local)
    expect(params).toContain(userId); // userId bound as a parameter
  });

  it('passes the tx handle into the callback', async () => {
    const { db, fakeTx } = makeFakeDb();
    const svc = new TenantDbService(db);
    let capturedTx: unknown;

    await svc.runAs(userId, (tx) => {
      capturedTx = tx;
      return Promise.resolve(undefined);
    });

    expect(capturedTx).toBe(fakeTx);
  });

  it('returns the result from the callback', async () => {
    const { db } = makeFakeDb();
    const svc = new TenantDbService(db);

    const result = await svc.runAs(userId, () => Promise.resolve(42));

    expect(result).toBe(42);
  });
});
