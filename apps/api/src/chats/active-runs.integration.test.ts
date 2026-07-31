/**
 * findActiveByUser (run-notification re-hydration) on a live DB (RLS):
 * - returns the owner's NON-terminal runs with the chat title;
 * - EXCLUDES terminal runs (completed/failed/cancelled/expired);
 * - a cross-tenant caller sees only their own active runs, never another
 *   owner's (owner-scoped by runs.user_id, no leak);
 * - a PUBLIC chat's active run still belongs only to its owner — visibility
 *   never widens who can see it via this endpoint.
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
import { seedModelContextSnapshot } from '../runs/model-context-snapshot.test-fixture';

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
      const snapshot = await seedModelContextSnapshot(tx, owner);
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId: owner,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: snapshot.id,
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

  it("a cross-tenant caller sees only their own active runs, never another owner's", async () => {
    const chatA = await newChat(a, 'Private A');
    await newRun(a, chatA);

    const chatB = await newChat(b, 'Private B');
    const runB = await newRun(b, chatB);

    const asB = await tenantDb.runAs(b, (tx) =>
      new RunsRepository(tx).findActiveByUser(b),
    );

    // B has their own active run, so an empty result here would ALSO fail —
    // this isn't vacuously true the way `[].every(...)` on a guaranteed-empty
    // set would be. B sees exactly their own run, and never A's.
    expect(asB.map((r) => r.id)).toEqual([runB]);
    expect(asB.every((r) => r.chatId !== chatA)).toBe(true);
  });

  it("a public chat's active run still belongs only to its owner, regardless of visibility", async () => {
    const publicChat = await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).create({
        ownerUserId: a,
        title: 'Public chat',
        visibility: 'public',
      }),
    );
    await newRun(a, publicChat.id);

    const asB = await tenantDb.runAs(b, (tx) =>
      new RunsRepository(tx).findActiveByUser(b),
    );

    expect(asB.some((r) => r.chatId === publicChat.id)).toBe(false);
  });
});
