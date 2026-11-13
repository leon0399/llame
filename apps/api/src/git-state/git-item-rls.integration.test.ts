/**
 * RLS integration test for stored `git` context items — requires a real
 * PostgreSQL connection (TEST_DATABASE_URL; the test:integration global setup
 * provisions one). Skipped without it.
 *
 * A `git` item is a part of an ordinary message row, so the row's tenant policy
 * is its only boundary: it holds the repository's branch, paths, and commit
 * subjects.
 */

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { MessagesRepository, type Db } from '../chats/chats-repository';

import { createGitItem, gitToldState } from './git-item';
import { type GitObservation } from './git-state-view';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const OBSERVATION: GitObservation = {
  kind: 'unavailable',
  reason: 'git_failed',
};

describeIfDb('git context items — cross-tenant isolation', () => {
  let sql: Sql;
  let db: Db;
  let userAId: string;
  let userBId: string;

  /** Runs `fn` in a transaction scoped to `userId`, as every request does. */
  const asUser = <T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(
        dsql`select set_config('app.current_user_id', ${userId}, true)`,
      );

      return fn(tx);
    });

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle({ client: sql });
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'User A', ${`git-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'User B', ${`git-b-${userBId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  // Scenario: Another owner cannot read git items
  it('owner B reads no git item of owner A, and told state follows the rows read', async () => {
    const chatId = crypto.randomUUID();

    const item = createGitItem({
      runId: crypto.randomUUID(),
      observation: OBSERVATION,
    });

    await asUser(userAId, async (tx) => {
      await tx.execute(
        dsql`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Git Chat')`,
      );
      await tx.execute(
        dsql`INSERT INTO messages (chat_id, seq, role, parts)
          VALUES (${chatId}, 1, 'user', ${dsql.param([item])}::jsonb)`,
      );
    });

    try {
      const own = await asUser(userAId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userAId),
      );

      const foreign = await asUser(userBId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userBId),
      );

      expect(own.flatMap((row) => row.parts)).toEqual([item]);
      expect(gitToldState(own.flatMap((row) => row.parts)).text).toBe(
        item.data.text,
      );
      expect(foreign).toEqual([]);
      expect(
        gitToldState(foreign.flatMap((row) => row.parts)).text,
      ).toBeUndefined();

      const raw = await asUser(userBId, (tx) =>
        tx.execute(dsql`SELECT id FROM messages WHERE chat_id = ${chatId}`),
      );

      expect(raw).toHaveLength(0);
    } finally {
      await asUser(userAId, (tx) =>
        tx.execute(dsql`DELETE FROM chats WHERE id = ${chatId}`),
      );
    }
  });
});
