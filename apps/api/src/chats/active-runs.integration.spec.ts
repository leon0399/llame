/**
 * findActiveByUser (run-notification re-hydration) on a live DB (RLS):
 * - returns the owner's NON-terminal runs with the chat title;
 * - EXCLUDES terminal runs (completed/failed/cancelled/expired);
 * - a cross-tenant caller sees none (owner-scoped by runs.user_id, no leak).
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
import { RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('findActiveByUser — RLS + non-terminal filter', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  const newChat = async (owner: string, title: string): Promise<string> => {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id, ownerUserId: owner, title }),
    );
    return id;
  };

  const newRun = async (owner: string, chatId: string): Promise<string> => {
    return tenantDb.runAs(owner, async (tx) => {
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'go' }],
      });
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId: owner,
      });
      return run.id;
    });
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
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'R', ${`r-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('returns the owner active runs with chat title, excluding terminal runs', async () => {
    const chat = await newChat(a, 'Walk-away chat');
    // The per-chat single-flight index admits at most one non-terminal run, so
    // finish the first before creating the active one. (Terminal transition must
    // run inside runAs — FORCE RLS blocks a raw update.)
    const doneRun = await newRun(a, chat);
    await tenantDb.runAs(a, (tx) =>
      new RunsRepository(tx).markFinished(doneRun, a, 'completed'),
    );
    const activeRun = await newRun(a, chat); // defaults to 'queued' (non-terminal)

    const active = await tenantDb.runAs(a, (tx) =>
      new RunsRepository(tx).findActiveByUser(a),
    );

    expect(active.map((r) => r.id)).toEqual([activeRun]);
    expect(active[0]?.chatTitle).toBe('Walk-away chat');
    expect(active[0]?.chatId).toBe(chat);
  });

  it('a cross-tenant caller sees none (owner-scoped by user_id, no leak)', async () => {
    const chat = await newChat(a, 'Private');
    await newRun(a, chat);

    const asB = await tenantDb.runAs(b, (tx) =>
      new RunsRepository(tx).findActiveByUser(b),
    );

    expect(asB.every((r) => r.chatId !== chat)).toBe(true);
  });
});
