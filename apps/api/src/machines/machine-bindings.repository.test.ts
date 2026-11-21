/**
 * MachineBindingsRepository — unit coverage for the two statements the
 * installation's binding table has, asserted on the payloads a real writer
 * would send rather than on the fact that a method was called:
 *
 * - the system marker runs inside the same transaction, BEFORE the write or
 *   the read it admits (it is the table's only policy);
 * - the bind inserts `on conflict (name) do nothing` and decides from the
 *   inserted row or the stored one: `bound`, `match`, or `mismatch`;
 * - a stored binding that vanished between the two statements fails closed;
 * - `forget` deletes by name and answers the id it held, or undefined.
 *
 * The fake scoped connection only knows the builders this repository uses and
 * records every statement, so an unexpected call shows up as a mismatch in the
 * recorded events instead of being silently satisfied.
 */

import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import { machineBindings } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

import { MachineBindingsRepository } from './machine-bindings.repository';

const MARKER_SQL = `select set_config('app.machines_system', '1', true)`;
const dialect = new PgDialect();
const NAME = 'devl';
const BOUND_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';

type BindingsInsert = typeof machineBindings.$inferInsert;

type RecordedInsert = {
  readonly table: typeof machineBindings;
  readonly values: BindingsInsert;
  readonly target: typeof machineBindings.name;
};

type RecordedSelect = {
  readonly table: typeof machineBindings;
  readonly where: SQL;
};

type RecordedDelete = {
  readonly table: typeof machineBindings;
  readonly where: SQL;
};

type BindingsDbFake = {
  readonly db: Db;
  readonly events: Array<string>;
  readonly executed: Array<SQL>;
  readonly inserts: Array<RecordedInsert>;
  readonly selects: Array<RecordedSelect>;
  readonly deletes: Array<RecordedDelete>;
};

/**
 * The transaction handle plus every statement the repository ran on it.
 * `inserted` decides whether the `ON CONFLICT DO NOTHING` insert returned a
 * row; `stored` is the id a following select finds (absent: no row at all);
 * `removed` is the id the delete returned (absent: nothing deleted).
 */
function bindingsDb(
  options: {
    inserted?: boolean;
    stored?: string;
    removed?: string;
  } = {},
): BindingsDbFake {
  const events: Array<string> = [];
  const executed: Array<SQL> = [];
  const inserts: Array<RecordedInsert> = [];
  const selects: Array<RecordedSelect> = [];
  const deletes: Array<RecordedDelete> = [];

  const scoped = drizzle.mock();
  Object.assign(scoped, {
    execute: (statement: SQL) => {
      events.push('execute');
      executed.push(statement);

      return Promise.resolve();
    },
    insert: (table: typeof machineBindings) => ({
      values: (values: BindingsInsert) => ({
        onConflictDoNothing: (conflict: {
          target: typeof machineBindings.name;
        }) => ({
          returning: () => {
            events.push('insert');
            inserts.push({ table, values, target: conflict.target });

            return Promise.resolve(
              options.inserted === true ? [{ name: values.name }] : [],
            );
          },
        }),
      }),
    }),
    select: () => ({
      from: (table: typeof machineBindings) => ({
        where: (where: SQL) => {
          events.push('select');
          selects.push({ table, where });

          const rows =
            options.stored === undefined
              ? []
              : [{ instanceId: options.stored }];

          return { limit: () => Promise.resolve(rows) };
        },
      }),
    }),
    delete: (table: typeof machineBindings) => ({
      where: (where: SQL) => ({
        returning: () => {
          events.push('delete');
          deletes.push({ table, where });

          return Promise.resolve(
            options.removed === undefined
              ? []
              : [{ instanceId: options.removed }],
          );
        },
      }),
    }),
  });

  const db = drizzle.mock();
  Object.assign(db, {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(scoped),
  });

  return { db, events, executed, inserts, selects, deletes };
}

describe('MachineBindingsRepository.bindOrCompare', () => {
  it('binds an unbound name after marking the transaction as the system context', async () => {
    const fake = bindingsDb({ inserted: true });

    await expect(
      new MachineBindingsRepository(fake.db).bindOrCompare(NAME, BOUND_ID),
    ).resolves.toBe('bound');

    // The marker must be the first statement: the insert before it would be
    // refused by the table's only policy.
    expect(fake.events).toEqual(['execute', 'insert']);
    expect(dialect.sqlToQuery(fake.executed[0])).toEqual({
      sql: MARKER_SQL,
      params: [],
    });
    const [insert] = fake.inserts;
    expect(insert.table).toBe(machineBindings);
    expect(insert.target).toBe(machineBindings.name);
    expect(insert.values).toEqual({ name: NAME, instanceId: BOUND_ID });
    // Nothing to compare when the insert won the name.
    expect(fake.selects).toEqual([]);
  });

  it('matches a stored id without touching the row', async () => {
    const fake = bindingsDb({ stored: BOUND_ID });

    await expect(
      new MachineBindingsRepository(fake.db).bindOrCompare(NAME, BOUND_ID),
    ).resolves.toBe('match');

    expect(fake.events).toEqual(['execute', 'insert', 'select']);
    const [insert] = fake.inserts;
    // The losing insert still offers the id; the stored row is what decides.
    expect(insert.values).toEqual({ name: NAME, instanceId: BOUND_ID });
    expect(fake.selects).toHaveLength(1);
    expect(fake.selects[0].table).toBe(machineBindings);
    const predicate = dialect.sqlToQuery(fake.selects[0].where);
    expect(predicate.sql).toBe('"machine_bindings"."name" = $1');
    expect(predicate.params).toEqual([NAME]);
    expect(fake.deletes).toEqual([]);
  });

  it('reports a mismatch when another id is already bound', async () => {
    const fake = bindingsDb({ stored: OTHER_ID });

    await expect(
      new MachineBindingsRepository(fake.db).bindOrCompare(NAME, BOUND_ID),
    ).resolves.toBe('mismatch');

    expect(fake.events).toEqual(['execute', 'insert', 'select']);
  });

  it('fails closed when the binding vanishes between the insert and the read', async () => {
    const fake = bindingsDb();

    await expect(
      new MachineBindingsRepository(fake.db).bindOrCompare(NAME, BOUND_ID),
    ).resolves.toBe('mismatch');
  });
});

describe('MachineBindingsRepository.forget', () => {
  it('removes the binding in the system context and returns the id it held', async () => {
    const fake = bindingsDb({ removed: BOUND_ID });

    await expect(
      new MachineBindingsRepository(fake.db).forget(NAME),
    ).resolves.toBe(BOUND_ID);

    expect(fake.events).toEqual(['execute', 'delete']);
    expect(dialect.sqlToQuery(fake.executed[0])).toEqual({
      sql: MARKER_SQL,
      params: [],
    });
    expect(fake.deletes).toHaveLength(1);
    expect(fake.deletes[0].table).toBe(machineBindings);
    const predicate = dialect.sqlToQuery(fake.deletes[0].where);
    expect(predicate.sql).toBe('"machine_bindings"."name" = $1');
    expect(predicate.params).toEqual([NAME]);
    expect(fake.inserts).toEqual([]);
  });

  it('returns undefined when nothing was bound', async () => {
    const fake = bindingsDb();

    await expect(
      new MachineBindingsRepository(fake.db).forget(NAME),
    ).resolves.toBeUndefined();

    expect(fake.events).toEqual(['execute', 'delete']);
    expect(fake.deletes).toHaveLength(1);
  });
});
