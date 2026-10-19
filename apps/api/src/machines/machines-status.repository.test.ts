/**
 * MachinesStatusRepository — unit coverage for the RLS split's two paths,
 * asserted on the payloads a real writer would send rather than on the fact
 * that a method was called:
 *
 * - the system marker runs inside the same transaction, BEFORE the write;
 * - a success stamps the contact and re-stamps the daemon report, keeping the
 *   last failure, while a failure touches only the failure fields;
 * - `listForUser` short-circuits before it touches the tenant connection and
 *   normalizes an off-vocabulary reason on the way out;
 * - `pruneExcept([])` deletes without a predicate and returns the statement's
 *   own row count.
 *
 * The fake scoped connection only knows the builders this repository uses and
 * records every statement, so an unexpected call shows up as a mismatch in the
 * recorded statements instead of being silently satisfied.
 */

import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { machinesStatus } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type MachineContact, type MachineStatusRow } from './machines-status';
import { MachinesStatusRepository } from './machines-status.repository';

const AT = new Date('2026-10-19T10:00:00.000Z');
const USER_ID = 'user-1';
const MARKER_SQL = `select set_config('app.machines_system', '1', true)`;
const dialect = new PgDialect();

/** One bounded row as the writer sends it. */
type StatusInsert = typeof machinesStatus.$inferInsert;

/**
 * A row as a reader gets it back. The reason is a plain string on purpose: the
 * CHECK constrains the column, and the guard in `listForUser` exists exactly
 * for the value the closed vocabulary does not know.
 */
type StoredRow = Omit<MachineStatusRow, 'lastFailureReason'> & {
  readonly lastFailureReason: string | null;
};

const STORED: StoredRow = {
  name: 'build-box',
  firstContactAt: AT,
  lastContactAt: AT,
  lastFailureAt: null,
  lastFailureReason: 'unreachable',
  hubProtocolVersion: 4,
  daemonProtocolVersion: 3,
  daemonVersion: '1.4.0',
  roots: ['/srv/repo'],
  updatedAt: AT,
};

type RecordedInsert = {
  readonly table: typeof machinesStatus;
  readonly values: StatusInsert;
  readonly target: typeof machinesStatus.name;
  readonly set: Partial<StatusInsert>;
};

type RecordedSelect = {
  readonly table: typeof machinesStatus;
  readonly where: SQL;
};

type RecordedDelete = {
  readonly table: typeof machinesStatus;
  where: SQL | undefined;
};

type StatusDbFake = {
  readonly db: Db;
  readonly scoped: Db;
  readonly events: Array<string>;
  readonly executed: Array<SQL>;
  readonly inserts: Array<RecordedInsert>;
  readonly selects: Array<RecordedSelect>;
  readonly deletes: Array<RecordedDelete>;
};

/** The transaction handle plus every statement the repository ran on it. */
function statusDb(
  options: {
    rows?: ReadonlyArray<StoredRow>;
    count?: number | null;
  } = {},
): StatusDbFake {
  const events: Array<string> = [];
  const executed: Array<SQL> = [];
  const inserts: Array<RecordedInsert> = [];
  const selects: Array<RecordedSelect> = [];
  const deletes: Array<RecordedDelete> = [];
  const count = options.count;

  const scoped = drizzle.mock({ schema });
  Object.assign(scoped, {
    execute: (statement: SQL) => {
      events.push('execute');
      executed.push(statement);
      return Promise.resolve();
    },
    insert: (table: typeof machinesStatus) => ({
      values: (values: StatusInsert) => ({
        onConflictDoUpdate: (conflict: {
          target: typeof machinesStatus.name;
          set: Partial<StatusInsert>;
        }) => {
          events.push('insert');
          inserts.push({
            table,
            values,
            target: conflict.target,
            set: conflict.set,
          });
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: (table: typeof machinesStatus) => ({
        where: (where: SQL) => {
          events.push('select');
          selects.push({ table, where });
          const rows = options.rows ?? [];
          return Object.assign(Promise.resolve(rows), {
            limit: (count: number) => Promise.resolve(rows.slice(0, count)),
          });
        },
      }),
    }),
    delete: (table: typeof machinesStatus) => {
      const statement: RecordedDelete = { table, where: undefined };
      events.push('delete');
      deletes.push(statement);
      return Object.assign(Promise.resolve({ count }), {
        where: (where: SQL) => {
          statement.where = where;
          return { count };
        },
      });
    },
  });

  const db = drizzle.mock({ schema });
  Object.assign(db, {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(scoped),
  });

  return { db, scoped, events, executed, inserts, selects, deletes };
}

type TenantDbFake = {
  readonly tenantDb: TenantDbService;
  /** The identity of every `runAs` call, in order. */
  readonly users: Array<string>;
};

/** A tenant service whose `runAs` runs the callback on the fake transaction. */
function tenantFake(scoped: Db): TenantDbFake {
  const users: Array<string> = [];
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) =>
      callback(scoped),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(userId: string, callback: (tx: Db) => Promise<T>) => {
      users.push(userId);
      return callback(scoped);
    },
  );
  return { tenantDb, users };
}

describe('MachinesStatusRepository.recordContact', () => {
  it('marks the transaction as the system context before inserting a successful contact', async () => {
    const fake = statusDb();
    const repository = new MachinesStatusRepository(
      fake.db,
      tenantFake(fake.scoped).tenantDb,
    );
    const contact: MachineContact = {
      name: 'build-box',
      at: AT,
      hubProtocolVersion: 4,
      daemonProtocolVersion: 3,
      daemonVersion: ' 1.4.0 ',
      roots: ['/srv/repo', 'not-absolute', '/srv/work', '/srv/repo'],
    };

    await expect(repository.recordContact(contact)).resolves.toBeUndefined();

    // The marker has to be the first statement in the transaction: a write that
    // ran before it would be refused by the system-write policy.
    expect(fake.events).toEqual(['execute', 'insert']);
    expect(dialect.sqlToQuery(fake.executed[0])).toEqual({
      sql: MARKER_SQL,
      params: [],
    });

    expect(fake.selects).toEqual([]);
    expect(fake.inserts).toEqual([
      {
        table: machinesStatus,
        values: {
          name: 'build-box',
          firstContactAt: AT,
          lastContactAt: AT,
          lastFailureAt: null,
          lastFailureReason: null,
          hubProtocolVersion: 4,
          daemonProtocolVersion: 3,
          daemonVersion: '1.4.0',
          roots: ['/srv/repo', '/srv/work'],
          updatedAt: AT,
        },
        target: machinesStatus.name,
        // A repeat success re-stamps the contact and the daemon report and
        // deliberately does NOT clear the previous failure.
        set: {
          lastContactAt: AT,
          hubProtocolVersion: 4,
          daemonProtocolVersion: 3,
          daemonVersion: '1.4.0',
          roots: ['/srv/repo', '/srv/work'],
          updatedAt: AT,
        },
      },
    ]);
  });

  it('records a failed contact as a failure only, with no contact stamp', async () => {
    const fake = statusDb();
    const repository = new MachinesStatusRepository(
      fake.db,
      tenantFake(fake.scoped).tenantDb,
    );
    const contact: MachineContact = {
      name: 'build-box',
      at: AT,
      hubProtocolVersion: 4,
      failure: 'host_key_mismatch',
    };

    await expect(repository.recordContact(contact)).resolves.toBeUndefined();

    expect(fake.events).toEqual(['execute', 'insert']);
    expect(fake.inserts).toEqual([
      {
        table: machinesStatus,
        values: {
          name: 'build-box',
          firstContactAt: null,
          lastContactAt: null,
          lastFailureAt: AT,
          lastFailureReason: 'host_key_mismatch',
          hubProtocolVersion: 4,
          daemonProtocolVersion: null,
          daemonVersion: null,
          roots: [],
          updatedAt: AT,
        },
        target: machinesStatus.name,
        // Only the failure fields move: the contact stamps of an earlier
        // success survive, and nothing claims the Machine was just seen.
        set: {
          lastFailureAt: AT,
          lastFailureReason: 'host_key_mismatch',
          hubProtocolVersion: 4,
          updatedAt: AT,
        },
      },
    ]);
  });
});

describe('MachinesStatusRepository.findForLive', () => {
  it('reads the row in the system context without a user identity', async () => {
    const fake = statusDb({ rows: [STORED] });
    const { tenantDb, users } = tenantFake(fake.scoped);
    const repository = new MachinesStatusRepository(fake.db, tenantDb);

    await expect(repository.findForLive('build-box')).resolves.toEqual(STORED);

    expect(users).toEqual([]);
    // The marker comes first: on the identity-less connection the system
    // policy is the only one that admits a select.
    expect(fake.events).toEqual(['execute', 'select']);
    expect(dialect.sqlToQuery(fake.executed[0])).toEqual({
      sql: MARKER_SQL,
      params: [],
    });
    const predicate = dialect.sqlToQuery(fake.selects[0].where);
    expect(predicate.sql).toBe('"machines_status"."name" = $1');
    expect(predicate.params).toEqual(['build-box']);
  });

  it('returns undefined when the row is gone and drops an off-vocabulary reason', async () => {
    const missing = statusDb();
    const missingRepository = new MachinesStatusRepository(
      missing.db,
      tenantFake(missing.scoped).tenantDb,
    );
    await expect(
      missingRepository.findForLive('gone'),
    ).resolves.toBeUndefined();

    const odd = statusDb({ rows: [{ ...STORED, lastFailureReason: 'odd' }] });
    const oddRepository = new MachinesStatusRepository(
      odd.db,
      tenantFake(odd.scoped).tenantDb,
    );
    await expect(oddRepository.findForLive('build-box')).resolves.toEqual({
      ...STORED,
      lastFailureReason: null,
    });
  });
});

describe('MachinesStatusRepository.listForUser', () => {
  it('returns nothing without opening a tenant transaction when no Machine is configured', async () => {
    const fake = statusDb({ rows: [STORED] });
    const { tenantDb, users } = tenantFake(fake.scoped);
    const repository = new MachinesStatusRepository(fake.db, tenantDb);

    await expect(repository.listForUser(USER_ID, [])).resolves.toEqual([]);

    expect(users).toEqual([]);
    expect(fake.events).toEqual([]);
  });

  it('reads the configured names under the caller identity and drops an off-vocabulary reason', async () => {
    const fake = statusDb({
      rows: [
        { ...STORED, lastFailureReason: 'unreachable' },
        { ...STORED, name: 'old-box', lastFailureReason: 'not-a-reason' },
      ],
    });
    const { tenantDb, users } = tenantFake(fake.scoped);
    const repository = new MachinesStatusRepository(fake.db, tenantDb);

    await expect(
      repository.listForUser(USER_ID, ['build-box', 'old-box']),
    ).resolves.toEqual([
      { ...STORED, lastFailureReason: 'unreachable' },
      { ...STORED, name: 'old-box', lastFailureReason: null },
    ]);

    expect(users).toEqual([USER_ID]);
    expect(fake.selects).toHaveLength(1);
    expect(fake.selects[0].table).toBe(machinesStatus);
    const predicate = dialect.sqlToQuery(fake.selects[0].where);
    expect(predicate.sql).toBe('"machines_status"."name" in ($1, $2)');
    expect(predicate.params).toEqual(['build-box', 'old-box']);
  });
});

describe('MachinesStatusRepository.pruneExcept', () => {
  it('deletes every row that is not still configured and returns the row count', async () => {
    const fake = statusDb({ count: 5 });
    const repository = new MachinesStatusRepository(
      fake.db,
      tenantFake(fake.scoped).tenantDb,
    );

    await expect(repository.pruneExcept(['build-box'])).resolves.toBe(5);

    expect(fake.events).toEqual(['execute', 'delete']);
    expect(dialect.sqlToQuery(fake.executed[0])).toEqual({
      sql: MARKER_SQL,
      params: [],
    });
    expect(fake.deletes).toHaveLength(1);
    expect(fake.deletes[0].table).toBe(machinesStatus);
    const predicate = fake.deletes[0].where;
    if (predicate === undefined) throw new Error('prune predicate missing');
    expect(dialect.sqlToQuery(predicate).sql).toBe(
      '"machines_status"."name" not in ($1)',
    );
    expect(dialect.sqlToQuery(predicate).params).toEqual(['build-box']);
  });

  it('deletes without a predicate when nothing is configured, and reads a missing count as zero', async () => {
    const fake = statusDb({ count: null });
    const repository = new MachinesStatusRepository(
      fake.db,
      tenantFake(fake.scoped).tenantDb,
    );

    await expect(repository.pruneExcept([])).resolves.toBe(0);

    expect(fake.events).toEqual(['execute', 'delete']);
    expect(fake.deletes).toHaveLength(1);
    // An empty configuration leaves nothing to keep, so the DELETE is
    // unfiltered rather than a `not in ()` that would match nothing.
    expect(fake.deletes[0].where).toBeUndefined();
  });
});
