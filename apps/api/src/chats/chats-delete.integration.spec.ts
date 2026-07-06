/**
 * Chat deletion on a live DB (RLS + FK cascade):
 * - owner delete removes the chat AND cascades its messages;
 * - a cross-tenant delete is a no-op (RLS) — the chat survives;
 * - ChatsService.deleteChat cancels an in-flight run BEFORE deleting (so the
 *   provider stream stops instead of billing until the deadman timeout).
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('chat deletion — RLS + cascade + run cancel', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  const newChat = async (owner: string): Promise<string> => {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id, ownerUserId: owner }),
    );
    return id;
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'D', ${`d-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('owner delete removes the chat and cascades its messages', async () => {
    const chat = await newChat(a);
    await tenantDb.runAs(a, async (tx) => {
      await new MessagesRepository(tx).create({
        chatId: chat,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'hi' }],
      });
    });

    const deleted = await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).deleteById(chat, a),
    );
    expect(deleted).toBe(true);

    // Chat gone, and the cascade cleaned the children (raw counts, no RLS).
    const [{ n: chatN }] =
      await sql`SELECT count(*)::int AS n FROM chats WHERE id = ${chat}`;
    const [{ n: msgN }] =
      await sql`SELECT count(*)::int AS n FROM messages WHERE chat_id = ${chat}`;
    expect({ chatN, msgN }).toEqual({ chatN: 0, msgN: 0 });
  });

  it('a cross-tenant delete is a no-op — the chat survives', async () => {
    const chat = await newChat(a);
    const deleted = await tenantDb.runAs(b, (tx) =>
      new ChatsRepository(tx).deleteById(chat, b),
    );
    expect(deleted).toBe(false);
    const survivor = await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).findById(chat, a),
    );
    expect(survivor?.id).toBe(chat);
  });

  it('deleteChat cancels an in-flight run before deleting', async () => {
    const chat = await newChat(a);
    const runId = crypto.randomUUID();
    // Seed a running run as the owner (RLS admits it inside runAs).
    await tenantDb.runAs(a, (tx) =>
      tx.insert(schema.runs).values({
        id: runId,
        chatId: chat,
        userId: a,
        status: 'running_model',
      }),
    );

    const aborts = new RunAbortRegistry();
    const abortSpy = jest.spyOn(aborts, 'abort');
    const service = new ChatsService(tenantDb, aborts);

    const deleted = await service.deleteChat(a, chat);
    expect(deleted).toBe(true);
    // The active run was aborted (in-process signal) before the cascade removed it.
    expect(abortSpy).toHaveBeenCalledWith(runId);
    const [{ n }] =
      await sql`SELECT count(*)::int AS n FROM runs WHERE id = ${runId}`;
    expect(n).toBe(0);
  });
});
