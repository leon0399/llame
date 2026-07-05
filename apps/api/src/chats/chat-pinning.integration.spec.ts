/**
 * Chat pinning on a live DB (RLS):
 * - pin/unpin sets/clears pinnedAt (owner-scoped) and does NOT bump updatedAt;
 * - a cross-tenant pin changes nothing (→ 404);
 * - findByOwner (getChatsByUserId) returns pinned chats first.
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
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('chat pinning — RLS + ordering', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    service = new ChatsService(tenantDb, new RunAbortRegistry());
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'P', ${`p-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('pin/unpin sets and clears pinnedAt without bumping updatedAt', async () => {
    const chat = await service.createChat({ ownerUserId: a, title: 'C' });
    const before = chat.updatedAt.getTime();

    const pinned = await service.updateChat(chat.id, a, { pinned: true });
    expect(pinned?.pinnedAt).toBeInstanceOf(Date);
    // A pin is metadata — it must not reorder the chat by recency.
    expect(pinned?.updatedAt.getTime()).toBe(before);

    const unpinned = await service.updateChat(chat.id, a, { pinned: false });
    expect(unpinned?.pinnedAt).toBeNull();
    expect(unpinned?.updatedAt.getTime()).toBe(before);
  });

  it('a cross-tenant pin changes nothing', async () => {
    const chat = await service.createChat({ ownerUserId: a, title: 'A owns' });

    const result = await service.updateChat(chat.id, b, { pinned: true });
    expect(result).toBeUndefined(); // not owned → 404

    const reread = await service.getChatById(chat.id, a);
    expect(reread?.pinnedAt).toBeNull();
  });

  it('getChatsByUserId returns pinned chats first', async () => {
    const owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'P', ${`p-${owner}@t.com`})`;
    try {
      const older = await service.createChat({
        ownerUserId: owner,
        title: 'older',
      });
      await service.createChat({ ownerUserId: owner, title: 'newer' });
      await service.updateChat(older.id, owner, { pinned: true });

      const list = await service.listChatsWithLastMessage(owner);
      expect(list[0].chat.id).toBe(older.id); // pinned first despite being older
      expect(list[0].chat.pinnedAt).toBeInstanceOf(Date);
    } finally {
      await sql`DELETE FROM users WHERE id = ${owner}`;
    }
  });
});
