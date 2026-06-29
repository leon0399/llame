/**
 * RLS integration tests — requires a real PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to a connection string to run. The connecting role MUST be:
 *   - NOT a superuser and NOT BYPASSRLS (those bypass RLS unconditionally), and
 *   - ideally the OWNER of the chats/messages tables — that is the worst case for a
 *     self-hosted deployment (one Postgres role owns, migrates, AND serves the app).
 *     RLS only constrains a table owner when FORCE ROW LEVEL SECURITY is set, so a
 *     green run as the owner proves FORCE is doing its job.
 *
 * Example (matches scripts/rls-test.sh, which provisions exactly this):
 *   TEST_DATABASE_URL="postgres://app:app@localhost:55432/llame_test" pnpm --filter api test
 *
 * If TEST_DATABASE_URL is not set, all tests in this file are skipped.
 *
 * Acceptance criteria covered (#53):
 * - RLS ENABLED *and* FORCED on chats + messages
 * - the connecting role is non-superuser (otherwise the test would be meaningless)
 * - SET LOCAL app.current_user_id correctly scopes reads
 * - cross-tenant read returns zero rows (chats and messages)
 * - messages.parts round-trips AI SDK v5 UIMessage parts (write→read equality)
 * - ChatsService.runAs engages RLS at the app layer (service-level isolation test)
 *
 * NOTE: this file uses `any` for the postgres.js client, loaded dynamically so the
 * module does not connect at import time when TEST_DATABASE_URL is absent.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import {
  ChatsRepository,
  MessagesRepository,
  type Db,
} from './chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsService } from './chats.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb('RLS integration — cross-tenant isolation under FORCE', () => {
  let sql: SqlClient;
  let db: Db;
  let userAId: string;
  let userBId: string;

  /**
   * Run `fn` inside a transaction scoped to `userId` via app.current_user_id.
   * Uses set_config(..., is_local = true) — the parameterizable equivalent of
   * `SET LOCAL` (plain `SET LOCAL x = $1` cannot take a bind parameter). This
   * mirrors what the request layer must do for every chats/messages query.
   */
  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    // Dynamic import to avoid connecting at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    // Local test databases (docker) have no TLS; only require it if the URL asks.
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 1 });
    // Drizzle client over the same connection — used to round-trip through the
    // actual production repository code path (not hand-rolled SQL).
    db = drizzle(sql, { schema });

    // users has no RLS, so the owner can seed it directly (no scope needed).
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'User A', ${`test-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'User B', ${`test-b-${userBId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      // chats/messages cascade from users; deleting the users is enough, but those
      // deletes touch chats under FORCE, so scope each cleanup to its owner.
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on both tables', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    // A superuser or BYPASSRLS role would make every assertion below vacuous.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('chats', 'messages')
      ORDER BY relname`;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true); // ENABLE
      expect(r.relforcerowsecurity).toBe(true); // FORCE — the load-bearing bit
    }
  });

  it('owner A can create and read their own chat', async () => {
    const chatId = crypto.randomUUID();
    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Chat A')`;
      const rows = await tx`SELECT id FROM chats WHERE id = ${chatId}`;
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(chatId);
      await tx`DELETE FROM chats WHERE id = ${chatId}`;
    });
  });

  it('cross-tenant read: owner B cannot see owner A chat (zero rows)', async () => {
    const chatId = crypto.randomUUID();
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Private A')`,
    );
    try {
      const rows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM chats WHERE id = ${chatId}`,
      );
      expect(rows.length).toBe(0);
    } finally {
      await asUser(userAId, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`);
    }
  });

  it('messages.parts round-trips AI SDK v5 UIMessage parts via the real repository (write→read equality)', async () => {
    // Exercises the PRODUCTION code path (Drizzle jsonb) inside an RLS-scoped
    // transaction — not hand-rolled SQL — so this proves the column round-trips
    // structured parts exactly as the app writes them.
    const parts = [
      { type: 'text', text: 'Hello round-trip' },
      { type: 'reasoning', text: 'thinking…', extra: { nested: [1, 2, 3] } },
    ];

    await db.transaction(async (tx) => {
      await tx.execute(
        dsql`select set_config('app.current_user_id', ${userAId}, true)`,
      );
      const chatsRepo = new ChatsRepository(tx as unknown as Db);
      const messagesRepo = new MessagesRepository(tx as unknown as Db);

      const chat = await chatsRepo.create({
        ownerUserId: userAId,
        title: 'RT',
      });
      const created = await messagesRepo.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userAId,
        parts,
      });
      expect(created.parts).toEqual(parts);

      const [readBack] = await messagesRepo.findByChatId(chat.id);
      expect(readBack.parts).toEqual(parts);

      await tx.execute(dsql`DELETE FROM chats WHERE id = ${chat.id}`); // cascades to messages
    });
  });

  it('messages cross-tenant: owner B cannot see owner A messages (zero rows)', async () => {
    const chatId = crypto.randomUUID();
    const msgId = crypto.randomUUID();

    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Private Chat')`;
      await tx`
        INSERT INTO messages (id, chat_id, role, parts)
        VALUES (${msgId}, ${chatId}, 'assistant', ${JSON.stringify([{ type: 'text', text: 'secret' }])})`;
    });
    try {
      const rows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM messages WHERE id = ${msgId}`,
      );
      expect(rows.length).toBe(0);
    } finally {
      await asUser(userAId, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`);
    }
  });
});

/**
 * Service-level RLS integration — proves the APP layer (ChatsService via
 * TenantDbService.runAs) correctly engages RLS for tenant isolation.
 *
 * This is the acceptance criterion: "ChatsService.createChat({ownerUserId: A})
 * succeeds; getChatsByUserId(A) returns it; getChatsByUserId(B) returns zero
 * of A's chats."
 */
describeIfDb(
  'ChatsService — app-layer RLS engagement via TenantDbService.runAs',
  () => {
    let sql: SqlClient;
    let db: Db;
    let svc: ChatsService;
    let userAId: string;
    let userBId: string;

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const postgres = require('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 1 });
      db = drizzle(sql, { schema });
      svc = new ChatsService(new TenantDbService(db));

      userAId = crypto.randomUUID();
      userBId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Svc User A', ${`svc-a-${userAId}@test.com`})`;
      await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Svc User B', ${`svc-b-${userBId}@test.com`})`;
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
        await sql.end();
      }
    });

    it('createChat + getChatsByUserId(A) returns the chat created by A', async () => {
      const chat = await svc.createChat({
        ownerUserId: userAId,
        title: 'Service Chat A',
      });

      expect(chat.id).toBeDefined();
      expect(chat.ownerUserId).toBe(userAId);

      const aChats = await svc.getChatsByUserId(userAId);
      const found = aChats.find((c) => c.id === chat.id);
      expect(found).toBeDefined();
      expect(found?.ownerUserId).toBe(userAId);
    });

    it('getChatsByUserId(B) returns zero of A chats (cross-tenant isolation via runAs)', async () => {
      const chat = await svc.createChat({
        ownerUserId: userAId,
        title: 'A-Only Chat',
      });

      const bChats = await svc.getChatsByUserId(userBId);
      const leaked = bChats.find((c) => c.id === chat.id);

      // B must not see A's chat — this proves RLS is engaged at the service layer.
      expect(leaked).toBeUndefined();
    });
  },
);
