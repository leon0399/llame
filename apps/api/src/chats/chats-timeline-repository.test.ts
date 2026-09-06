import { isSQLWrapper, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { timelineByOwner } from './chats-timeline-repository';

const dialect = new PgDialect();

function makeMockDb(): Db {
  return drizzle.mock({ schema });
}

/**
 * Drizzle's terminal builders carry private state no structural double can
 * satisfy, so a spy that replaces one has to hand back a plain thenable
 * through the `never` bottom type (mirrors chats-repository.test.ts).
 */
function asDbQuery<T extends object>(query: T): never {
  // SAFETY: every double passed here implements exactly the fluent methods
  // the repository under test calls, and settles as a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function spyOnStatements(db: Db): Array<SQL> {
  const statements: Array<SQL> = [];
  vi.spyOn(db, 'execute').mockImplementation((statement) => {
    // `db.execute` also accepts a raw string; the repository under test only
    // ever passes a drizzle `sql` template, so this narrows without a cast.
    if (isSQLWrapper(statement)) statements.push(statement.getSQL());
    return asDbQuery(Promise.resolve([]));
  });
  return statements;
}

describe('timelineByOwner', () => {
  it('rejects a blank owner id before touching the database', async () => {
    const db = makeMockDb();
    const execute = vi.spyOn(db, 'execute');

    await expect(timelineByOwner(db, '   ', { limit: 10 })).rejects.toThrow(
      'non-empty userId',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('sets a 3s statement timeout before the main query', async () => {
    const db = makeMockDb();
    const statements = spyOnStatements(db);

    await timelineByOwner(db, 'owner-1', { limit: 10 });

    expect(statements).toHaveLength(2);
    expect(dialect.sqlToQuery(statements[0]).sql).toBe(
      'SET LOCAL statement_timeout = 3000',
    );
  });

  it('scopes to the owner, carries the reader identity guard, and reuses the eligibility predicate', async () => {
    const db = makeMockDb();
    const statements = spyOnStatements(db);

    await timelineByOwner(db, 'owner-1', { limit: 10 });

    const { sql: text, params } = dialect.sqlToQuery(statements[1]);
    expect(text).toContain('c.owner_user_id = $1');
    expect(text).toContain("current_setting('app.current_user_id', true) = $2");
    expect(text).toContain('"m".role');
    expect(params[0]).toBe('owner-1');
    expect(params[1]).toBe('owner-1');
  });

  it('orders by last activity descending, tie-broken by chat id, and fetches limit + 1', async () => {
    const db = makeMockDb();
    const statements = spyOnStatements(db);

    await timelineByOwner(db, 'owner-1', { limit: 10 });

    const { sql: text, params } = dialect.sqlToQuery(statements[1]);
    expect(text).toContain('ORDER BY MAX(m.created_at) DESC, c.id');
    expect(text).toContain('LIMIT $3');
    expect(params[2]).toBe(11);
  });

  it('applies exactly one clause for a one-sided range and none when unbounded', async () => {
    const db1 = makeMockDb();
    const noRange = spyOnStatements(db1);
    await timelineByOwner(db1, 'owner-1', { limit: 10 });
    const noRangeSql = dialect.sqlToQuery(noRange[1]).sql;
    expect(noRangeSql).not.toContain('created_at >=');
    expect(noRangeSql).not.toContain('created_at <');

    const db2 = makeMockDb();
    const afterOnly = spyOnStatements(db2);
    await timelineByOwner(db2, 'owner-1', {
      limit: 10,
      after: new Date('2026-02-01T00:00:00.000Z'),
    });
    const afterOnlySql = dialect.sqlToQuery(afterOnly[1]).sql;
    expect(afterOnlySql).toContain('m.created_at >= $3::timestamptz');
    expect(afterOnlySql).not.toContain('created_at <');

    const db3 = makeMockDb();
    const beforeOnly = spyOnStatements(db3);
    await timelineByOwner(db3, 'owner-1', {
      limit: 10,
      before: new Date('2026-03-01T00:00:00.000Z'),
    });
    const beforeOnlySql = dialect.sqlToQuery(beforeOnly[1]).sql;
    expect(beforeOnlySql).toContain('m.created_at < $3::timestamptz');
    expect(beforeOnlySql).not.toContain('created_at >=');
  });

  it('maps stringified counts and sequences to numbers and passes timestamps through', async () => {
    const db = makeMockDb();
    vi.spyOn(db, 'execute')
      .mockImplementationOnce(() => asDbQuery(Promise.resolve(undefined)))
      .mockImplementationOnce(() =>
        asDbQuery(
          Promise.resolve([
            {
              chat_id: 'chat-1',
              title: 'Hello',
              first_activity_at: new Date('2026-02-10T00:00:00.000Z'),
              last_activity_at: '2026-02-12T00:00:00.000Z',
              message_count: '3',
              first_seq: '5',
              last_seq: '9',
            },
          ]),
        ),
      );

    const regions = await timelineByOwner(db, 'owner-1', { limit: 10 });

    expect(regions).toStrictEqual([
      {
        chatId: 'chat-1',
        title: 'Hello',
        firstActivityAt: new Date('2026-02-10T00:00:00.000Z'),
        lastActivityAt: new Date('2026-02-12T00:00:00.000Z'),
        messageCount: 3,
        firstSeq: 5,
        lastSeq: 9,
      },
    ]);
  });
});
