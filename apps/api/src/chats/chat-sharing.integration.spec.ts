/**
 * Chat sharing on a live DB — the SECURITY-critical negatives for a feature
 * that relaxes tenant isolation:
 * - a PUBLIC chat + its messages are readable via runAsPublic (no identity);
 * - a PRIVATE chat is NOT — never leaked, no messages either (the whole point);
 * - a non-owner cannot flip visibility (owner policy);
 * - the public context grants NO write (SELECT-only policies);
 * - the shared DTO strips reasoning + user ids;
 * - sharing one chat leaks nothing about the owner's OTHER chats (public or
 *   private), even when both exist side by side.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';

import * as schema from '../db/schema';
import { chats } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { toSharedChatResponse } from './dto/chats.dto';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('chat sharing — RLS relaxation is safe', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let owner: string;
  let other: string;

  // Seed a chat owned by `owner` with a user turn + an assistant turn whose
  // parts include reasoning (to prove the share strips it).
  const seedChat = async (
    visibility: 'private' | 'public',
    title?: string,
  ): Promise<string> => {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id,
        ownerUserId: owner,
        title,
      });
      if (visibility === 'public') {
        await new ChatsRepository(tx).update(id, owner, { visibility });
      }
      const messages = new MessagesRepository(tx);
      await messages.create({
        chatId: id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'a public question' }],
      });
      await messages.create({
        chatId: id,
        role: 'assistant',
        senderUserId: null,
        parts: [
          { type: 'reasoning', text: 'PRIVATE_THINKING about a memory' },
          { type: 'text', text: 'the public answer' },
        ],
      });
    });
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
    service = new ChatsService(tenantDb, new RunAbortRegistry());
    owner = crypto.randomUUID();
    other = crypto.randomUUID();
    for (const id of [owner, other]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'S', ${`s-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${other})`;
      await sql.end();
    }
  });

  it('runAsPublic reads a PUBLIC chat + its messages', async () => {
    const chat = await seedChat('public');
    const found = await tenantDb.runAsPublic((tx) =>
      new ChatsRepository(tx).findPublicById(chat),
    );
    expect(found?.id).toBe(chat);
    const messages = await tenantDb.runAsPublic((tx) =>
      new MessagesRepository(tx).listPublicByChatId(chat),
    );
    expect(messages.length).toBe(2);
  });

  it('runAsPublic NEVER leaks a PRIVATE chat or its messages', async () => {
    const chat = await seedChat('private');
    const found = await tenantDb.runAsPublic((tx) =>
      new ChatsRepository(tx).findPublicById(chat),
    );
    expect(found).toBeUndefined();
    const messages = await tenantDb.runAsPublic((tx) =>
      new MessagesRepository(tx).listPublicByChatId(chat),
    );
    expect(messages).toEqual([]);
  });

  it('making a public chat private immediately revokes the public read', async () => {
    const chat = await seedChat('public');
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).update(chat, owner, { visibility: 'private' }),
    );
    const found = await tenantDb.runAsPublic((tx) =>
      new ChatsRepository(tx).findPublicById(chat),
    );
    expect(found).toBeUndefined();
  });

  it('a non-owner cannot flip visibility', async () => {
    const chat = await seedChat('private');
    const updated = await tenantDb.runAs(other, (tx) =>
      new ChatsRepository(tx).update(chat, other, { visibility: 'public' }),
    );
    expect(updated).toBeUndefined();
    // …and it's still private.
    const found = await tenantDb.runAsPublic((tx) =>
      new ChatsRepository(tx).findPublicById(chat),
    );
    expect(found).toBeUndefined();
  });

  it('the public context grants NO write (SELECT-only policies)', async () => {
    const chat = await seedChat('public');
    const rows = await tenantDb.runAsPublic((tx) =>
      tx
        .update(chats)
        .set({ title: 'HACKED' })
        .where(and(eq(chats.id, chat), eq(chats.visibility, 'public')))
        .returning({ id: chats.id }),
    );
    expect(rows).toEqual([]); // 0 rows — no write policy for current_user=''
    const survivor = await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).findById(chat, owner),
    );
    expect(survivor?.title).not.toBe('HACKED');
  });

  it('an AUTHENTICATED read cannot see another user’s public chat via RLS alone (invariant preserved)', async () => {
    const chat = await seedChat('public'); // owned by `owner`, public
    // `other` (a different authenticated user) does a RAW select with NO
    // owner/app predicate — relying only on RLS. The public-read policy is gated
    // on current_user='' so it does NOT apply here; only chats_owner does, which
    // `other` fails. So RLS alone still scopes to own chats — public chats never
    // OR into a normal authenticated read.
    const rows = await tenantDb.runAs(other, (tx) =>
      tx.select().from(chats).where(eq(chats.id, chat)),
    );
    expect(rows).toEqual([]);
  });

  it('getSharedChat: public returns a title-stripped DTO; private returns undefined', async () => {
    const pub = await seedChat('public');
    const shared = await service.getSharedChat(pub);
    expect(shared).toBeDefined();
    const dto = toSharedChatResponse(shared!.chat, shared!.messages);
    // Reasoning is stripped; only text parts survive.
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('PRIVATE_THINKING');
    expect(serialized).toContain('the public answer');
    // No identity fields.
    expect(serialized).not.toContain('senderUserId');
    expect(serialized).not.toContain(owner);

    const priv = await seedChat('private');
    expect(await service.getSharedChat(priv)).toBeUndefined();
  });

  // Acceptance criterion: sharing one chat must leak NOTHING about the
  // owner's OTHER chats — public or private. `owner` has two chats at once
  // (unlike the isolated per-`it` chats above), so this specifically proves
  // fetching one shared id can't be leveraged to discover a sibling.
  it("sharing one chat leaks nothing about the owner's other chats", async () => {
    const publicChatA = await seedChat('public', 'Chat A (public)');
    const privateChatB = await seedChat('private', 'Chat B (private, secret)');

    const sharedA = await service.getSharedChat(publicChatA);
    expect(sharedA).toBeDefined();
    const dtoA = toSharedChatResponse(sharedA!.chat, sharedA!.messages);

    // The response for A only ever contains A's id/title/messages — no
    // reference to B (id, title, or content) anywhere in the payload.
    const serializedA = JSON.stringify(dtoA);
    expect(dtoA.id).toBe(publicChatA);
    expect(serializedA).not.toContain(privateChatB);
    expect(serializedA).not.toContain('secret');

    // B is independently still not shareable, proving the two chats' public
    // visibility is scoped per-row, not per-owner.
    expect(await service.getSharedChat(privateChatB)).toBeUndefined();
    const foundB = await tenantDb.runAsPublic((tx) =>
      new ChatsRepository(tx).findPublicById(privateChatB),
    );
    expect(foundB).toBeUndefined();
  });
});
