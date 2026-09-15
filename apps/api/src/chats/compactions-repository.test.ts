/**
 * CompactionsRepository unit tests — the owner fork's lineage read
 * (complete-owner-forks D2).
 *
 * `findByChatId` is the read the owner fork copies a source's checkpoint chain
 * from, so these assert the compiled SQL actually carries the prefix bound the
 * fork passes: an explicit anchor must not pull in a checkpoint covering
 * messages past it, and no anchor must leave the chain unbounded.
 *
 * Owner scoping is proven alongside in chats-repository.test.ts; real RLS
 * enforcement (cross-tenant isolation) is proven against a live Postgres in
 * chats-rls.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { CompactionsRepository, type Db } from './chats-repository';
import * as schema from '../db/schema';

type LoggedQuery = {
  sql: string;
  params: Array<unknown>;
};

// Use Drizzle's native mock database and its public logger boundary. Queries are
// compiled by real Drizzle builders, then logged before the mock client attempts
// execution. This keeps these unit tests focused on SQL shape without forging a
// Db-compatible fluent builder.
function makeMockDb() {
  const queries: Array<LoggedQuery> = [];
  const db: Db = drizzle.mock({
    schema,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });

  return { db, queries };
}

function queryContains(
  queries: Array<LoggedQuery>,
  value: string | number,
): boolean {
  return queries.some((query) => query.params.includes(value));
}

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);
  if (!query) {
    throw new Error('expected a logged database query');
  }
  return query;
}

describe('CompactionsRepository.findByChatId — fork lineage prefix', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';

  it('bounds the copied lineage inclusively at an explicit fork anchor', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .findByChatId(chatId, ownerUserId, { maxSeq: 42 })
      .catch(() => null);

    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(lastQuery(queries).sql).toContain('"chats"."owner_user_id" = $');
    expect(lastQuery(queries).sql).toContain('"compactions"."upto_seq" <= $');
    expect(lastQuery(queries).sql).toContain(
      'order by "compactions"."upto_seq" asc',
    );
  });

  it('reads the whole lineage, unbounded, when no fork anchor is given', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .findByChatId(chatId, ownerUserId)
      .catch(() => null);

    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(lastQuery(queries).sql).toContain('"chats"."owner_user_id" = $');
    expect(lastQuery(queries).sql).not.toContain('"upto_seq" <=');
    expect(lastQuery(queries).params).toHaveLength(2);
    expect(lastQuery(queries).sql).toContain(
      'order by "compactions"."upto_seq" asc',
    );
  });
});
