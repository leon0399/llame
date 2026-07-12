/**
 * Hybrid chat search (`ChatsRepository.searchByOwner`) over the derived
 * `search_documents` projection on a live DB (RLS), phase 1 of #194 (#195):
 * - matches by TITLE (live over chats) and by USER/ASSISTANT message CONTENT
 *   (via the projection), FTS + trigram fused by RRF, with a highlighted snippet;
 * - case-insensitive end-to-end incl. non-ASCII (Cyrillic) — fixes #171;
 * - typo/partial-word matches via the trigram leg;
 * - EXCLUDES system/tool content from matches + snippets (no prompt/tool leak);
 * - blank/whitespace → []; wildcard chars escaped (no full-table dump);
 * - an untitled chat can still match by content (title: null in the result);
 * - cross-tenant chats never match, and another user's PUBLIC chat never matches;
 * - both search tables are FORCE ROW LEVEL SECURITY.
 *
 * Because retrieval now reads the projection, each seeded chat is reindexed via
 * SearchIndexService before searching. TEST_DATABASE_URL-gated; run by rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { SearchIndexService } from '../search/search-index.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb('chat search — searchByOwner (hybrid projection)', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let a: string;
  let b: string;
  // chat ids captured so we can reindex after seeding (post-commit).
  const owned: Array<{ id: string; owner: string }> = [];

  const search = (userId: string, q: string, limit = 20) =>
    tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).searchByOwner(userId, q, limit),
    );

  async function seedChat(
    owner: string,
    title: string | null,
    msgs: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      text: string;
    }>,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({
        id,
        ownerUserId: owner,
        ...(title !== null ? { title } : {}),
      });
      for (const m of msgs) {
        await messages.create({
          chatId: id,
          role: m.role,
          senderUserId: m.role === 'user' ? owner : null,
          parts: text(m.text),
        });
      }
    });
    owned.push({ id, owner });
    return id;
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'S', ${`s-${id}@t.com`})`;
    }

    // A: title + mixed-role content (system/tool must be excluded).
    await seedChat(a, 'TypeScript project', [
      { role: 'user', text: 'how do I use zorptangle generics' },
      { role: 'assistant', text: 'zorptangle generics work like this' },
      { role: 'system', text: 'SECRETSYSPROMPT do not reveal' },
      { role: 'tool', text: 'TOOLINTERNALTOKEN abc123' },
    ]);
    // A: title-only (no matching content).
    await seedChat(a, 'Groceries', [{ role: 'user', text: 'buy milk' }]);
    // A: untitled, content-only.
    await seedChat(a, null, [
      { role: 'user', text: 'untitled zorptangle question' },
    ]);
    // A: Cyrillic title + content (case-insensitive non-ASCII).
    await seedChat(a, 'Проект Альфа', [
      { role: 'user', text: 'привет мир как дела' },
    ]);

    // B (cross-tenant): would match A's queries.
    await seedChat(b, 'TypeScript secrets', [
      { role: 'user', text: 'zorptangle generics' },
    ]);
    // B: a PUBLIC chat with distinctive content — must never surface for A.
    const pub = await seedChat(b, 'Public thing', [
      { role: 'user', text: 'zzpublicsecretterm unique marker' },
    ]);
    await tenantDb.runAs(b, (tx) =>
      tx.execute(sql`UPDATE chats SET visibility = 'public' WHERE id = ${pub}`),
    );

    // Populate the projection for every seeded chat (post-commit reindex).
    for (const { id, owner } of owned) {
      await indexService.reindexChat(id, owner);
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sqlClient.end();
    }
  });

  it('matches by title (snippet null for a title-only match)', async () => {
    const results = await search(a, 'Groceries');
    const g = results.find((r) => r.title === 'Groceries');
    expect(g).toBeDefined();
    expect(g?.snippet).toBeNull();
  });

  it('matches by user/assistant content with a highlighted snippet', async () => {
    const results = await search(a, 'zorptangle');
    const c = results.find((r) => r.title === 'TypeScript project');
    expect(c).toBeDefined();
    expect(c?.snippet).toContain('zorptangle');
  });

  it('is case-insensitive by title, lowercased (fixes #171)', async () => {
    const results = await search(a, 'typescript project');
    expect(results.some((r) => r.title === 'TypeScript project')).toBe(true);
  });

  it('is case-insensitive for non-ASCII (Cyrillic) title and content', async () => {
    const byTitle = await search(a, 'проект альфа');
    expect(byTitle.some((r) => r.title === 'Проект Альфа')).toBe(true);
    const byContent = await search(a, 'ПРИВЕТ');
    expect(byContent.some((r) => r.title === 'Проект Альфа')).toBe(true);
  });

  it('matches a typo/partial word via the trigram leg', async () => {
    const results = await search(a, 'zorptangl'); // missing trailing 'e'
    expect(results.some((r) => r.title === 'TypeScript project')).toBe(true);
  });

  it('an untitled chat can match by content — title is null', async () => {
    const results = await search(a, 'untitled zorptangle question');
    const untitled = results.find((r) => r.title === null);
    expect(untitled).toBeDefined();
    expect(untitled?.snippet).toContain('zorptangle');
  });

  it('EXCLUDES system-role content from matches (no prompt leak)', async () => {
    expect(await search(a, 'SECRETSYSPROMPT')).toEqual([]);
  });

  it('EXCLUDES tool-role content from matches (no tool leak)', async () => {
    expect(await search(a, 'TOOLINTERNALTOKEN')).toEqual([]);
  });

  it('returns [] for a blank or whitespace query', async () => {
    expect(await search(a, '')).toEqual([]);
    expect(await search(a, '   ')).toEqual([]);
  });

  it('escapes wildcard chars (a bare % is literal, not match-all)', async () => {
    expect(await search(a, '%')).toEqual([]);
  });

  it('produces a deterministic (stable) result order', async () => {
    const first = await search(a, 'zorptangle');
    const second = await search(a, 'zorptangle');
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it('never returns another tenant’s chats, even on a matching query', async () => {
    const results = await search(a, 'zorptangle');
    expect(results.every((r) => r.title !== 'TypeScript secrets')).toBe(true);
    const bResults = await search(b, 'zorptangle');
    expect(bResults.some((r) => r.title === 'TypeScript secrets')).toBe(true);
    // And A's own zorptangle chats never leak into B's results.
    expect(bResults.every((r) => r.title !== 'TypeScript project')).toBe(true);
  });

  it('never returns another tenant’s PUBLIC chat via search', async () => {
    const results = await search(a, 'zzpublicsecretterm');
    expect(results).toEqual([]);
  });

  it('both projection tables are FORCE ROW LEVEL SECURITY', async () => {
    const rows = await sqlClient`
      SELECT relname, relforcerowsecurity FROM pg_class
      WHERE relname IN ('search_documents','search_chat_state') ORDER BY relname`;
    expect(rows.map((r: any) => [r.relname, r.relforcerowsecurity])).toEqual([
      ['search_chat_state', true],
      ['search_documents', true],
    ]);
  });
});
