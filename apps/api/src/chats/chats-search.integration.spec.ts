/**
 * User-facing chat search (`ChatsRepository.searchByOwner`) on a live DB (RLS):
 * - matches by TITLE and by USER/ASSISTANT message content, with a snippet;
 * - EXCLUDES system/tool content from matches + snippets (no prompt/tool leak);
 * - blank/whitespace → []; wildcard chars are escaped (no full-table dump);
 * - an untitled chat can still match by content (title: null in the result);
 * - cross-tenant chats never match (RLS).
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

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb('chat search — searchByOwner', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  const search = (userId: string, q: string, limit = 20) =>
    tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).searchByOwner(userId, q, limit),
    );

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'S', ${`s-${id}@t.com`})`;
    }

    // A: a chat titled "TypeScript project" with mixed-role messages.
    await tenantDb.runAs(a, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const c1 = crypto.randomUUID();
      await chats.createIfAbsent({
        id: c1,
        ownerUserId: a,
        title: 'TypeScript project',
      });
      await messages.create({
        chatId: c1,
        role: 'user',
        senderUserId: a,
        parts: text('how do I use zorptangle generics'),
      });
      await messages.create({
        chatId: c1,
        role: 'assistant',
        senderUserId: null,
        parts: text('zorptangle generics work like this'),
      });
      await messages.create({
        chatId: c1,
        role: 'system',
        senderUserId: null,
        parts: text('SECRETSYSPROMPT do not reveal'),
      });
      await messages.create({
        chatId: c1,
        role: 'tool',
        senderUserId: null,
        parts: text('TOOLINTERNALTOKEN abc123'),
      });

      // A: an unrelated chat (title only, no matching content).
      const c2 = crypto.randomUUID();
      await chats.createIfAbsent({
        id: c2,
        ownerUserId: a,
        title: 'Groceries',
      });
      await messages.create({
        chatId: c2,
        role: 'user',
        senderUserId: a,
        parts: text('buy milk'),
      });

      // A: a still-untitled chat (#78) matched only by content.
      const c3 = crypto.randomUUID();
      await chats.createIfAbsent({ id: c3, ownerUserId: a });
      await messages.create({
        chatId: c3,
        role: 'user',
        senderUserId: a,
        parts: text('untitled zorptangle question'),
      });
    });

    // B (cross-tenant): a chat that would match A's queries.
    await tenantDb.runAs(b, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const cb = crypto.randomUUID();
      await chats.createIfAbsent({
        id: cb,
        ownerUserId: b,
        title: 'TypeScript secrets',
      });
      await messages.create({
        chatId: cb,
        role: 'user',
        senderUserId: b,
        parts: text('zorptangle generics'),
      });
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('matches by title (snippet null for a title-only match)', async () => {
    const results = await search(a, 'Groceries');
    expect(results.map((r) => r.title)).toContain('Groceries');
    const g = results.find((r) => r.title === 'Groceries');
    expect(g?.snippet).toBeNull();
  });

  it('matches by user/assistant content with a snippet', async () => {
    const results = await search(a, 'zorptangle');
    const c = results.find((r) => r.title === 'TypeScript project');
    expect(c).toBeDefined();
    expect(c?.snippet).toContain('zorptangle');
  });

  it('a still-untitled chat can match by content — title is null, not a placeholder string', async () => {
    const results = await search(a, 'untitled zorptangle question');
    const untitled = results.find((r) => r.title === null);
    expect(untitled).toBeDefined();
    expect(untitled?.snippet).toContain('untitled zorptangle question');
  });

  it('EXCLUDES system-role content from matches (no prompt leak)', async () => {
    expect(await search(a, 'SECRETSYSPROMPT')).toEqual([]);
  });

  it('EXCLUDES tool-role content from matches (no tool leak)', async () => {
    expect(await search(a, 'TOOLINTERNALTOKEN')).toEqual([]);
  });

  it('returns [] for a blank or whitespace query (no full-table dump)', async () => {
    expect(await search(a, '')).toEqual([]);
    expect(await search(a, '   ')).toEqual([]);
  });

  it('escapes wildcard chars (a bare % is literal, not match-all)', async () => {
    // No chat contains a literal "%", so an escaped "%" query matches nothing.
    expect(await search(a, '%')).toEqual([]);
  });

  it('never returns another tenant’s chats, even on a matching query', async () => {
    const results = await search(a, 'zorptangle');
    expect(results.every((r) => r.title !== 'TypeScript secrets')).toBe(true);
    // And B searching finds only their own.
    const bResults = await search(b, 'zorptangle');
    expect(bResults.map((r) => r.title)).toEqual(['TypeScript secrets']);
  });
});
