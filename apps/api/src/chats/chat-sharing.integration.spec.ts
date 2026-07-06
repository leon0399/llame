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

  // Acceptance criterion: faithfulness is the invariant, not a length cap
  // (same reasoning that removed the owner fork's message cap). Per-request
  // cost on this unauthenticated, uncached endpoint is bounded by pagination
  // — mirroring the owner history API's beforeSeq/limit contract — not by
  // truncating the conversation. Proves BOTH halves: every page is bounded
  // to the requested limit, AND walking the cursor backward (the same way
  // the web's paginateAllMessages walks the owner history) reaches the exact
  // full conversation, well past what the old cap would have allowed.
  it('paginates via limit/beforeSeq — bounded per page, but the WHOLE conversation stays reachable (no length cap)', async () => {
    const chat = await seedChat('public');
    const total = 550; // comfortably past the old (now-removed) 500-message cap

    await tenantDb.runAs(owner, async (tx) => {
      const rows: Parameters<MessagesRepository['createMany']>[0] = Array.from(
        { length: total },
        (_, i) => ({
          id: crypto.randomUUID(),
          chatId: chat,
          role: i % 2 === 0 ? 'user' : 'assistant',
          senderUserId: i % 2 === 0 ? owner : null,
          parts: [{ type: 'text', text: `turn-${i}` }],
          attachments: [],
          inReplyTo: null,
        }),
      );
      await new MessagesRepository(tx).createMany(rows);
    });

    const PAGE_SIZE = 100;
    const pages: (string | undefined)[][] = [];
    let beforeSeq: number | undefined;

    // Walk backward exactly like the web's paginateAllMessages: each page
    // comes back oldest-first; prepending pages reconstructs the full
    // ascending order once the start of the conversation is reached (a page
    // shorter than PAGE_SIZE).
    for (let guard = 0; guard < 20; guard++) {
      const shared = await service.getSharedChat(chat, {
        limit: PAGE_SIZE,
        beforeSeq,
      });
      const messages = shared!.messages;
      if (messages.length === 0) break;

      expect(messages.length).toBeLessThanOrEqual(PAGE_SIZE);
      // getSharedChat returns RAW rows (pre-DTO) — the seeded assistant
      // message's first part is reasoning, so find the TEXT part rather than
      // indexing [0] (that stripping only happens in toSharedChatResponse,
      // exercised separately above).
      pages.unshift(
        messages.map(
          (m) =>
            (m.parts as { type: string; text: string }[]).find(
              (p) => p.type === 'text',
            )?.text,
        ),
      );

      beforeSeq = messages[0].seq;
      if (messages.length < PAGE_SIZE) break; // reached the conversation start
    }

    const walked = pages.flat();
    // +2 from seedChat's own seeded turn pair, at the very start.
    expect(walked.length).toBe(total + 2);
    expect(walked[0]).toBe('a public question');
    expect(walked[1]).toBe('the public answer');
    expect(walked[2]).toBe('turn-0');
    expect(walked.at(-1)).toBe(`turn-${total - 1}`);
    // Numeric ascending order, no gaps, no duplicates across the page walk.
    const numeric = walked
      .slice(2)
      .map((t) => Number(t!.slice('turn-'.length)));
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));

    // A single page is always bounded to PAGE_SIZE regardless of how long the
    // conversation is — this is the actual per-request cost guarantee,
    // supplied by pagination instead of a cap.
    const firstPage = await service.getSharedChat(chat, { limit: PAGE_SIZE });
    expect(firstPage!.messages.length).toBe(PAGE_SIZE);
  });

  describe('forkSharedChat — an authenticated visitor copies a PUBLIC chat into their own tenancy', () => {
    it('a private chat cannot be forked (404, no existence oracle)', async () => {
      const chat = await seedChat('private');
      expect(await service.forkSharedChat(chat, other)).toBeUndefined();
    });

    it('an absent chat cannot be forked — same outcome as a private one', async () => {
      expect(
        await service.forkSharedChat(crypto.randomUUID(), other),
      ).toBeUndefined();
    });

    it('unsharing after the link was issued immediately blocks forking', async () => {
      const chat = await seedChat('public');
      await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).update(chat, owner, { visibility: 'private' }),
      );
      expect(await service.forkSharedChat(chat, other)).toBeUndefined();
    });

    it('forks faithfully into the caller’s own tenancy, stripped of reasoning and sender identity (asserted on the PERSISTED rows, not just the DTO)', async () => {
      const chat = await seedChat('public');
      const forked = await service.forkSharedChat(chat, other);
      expect(forked).toBeDefined();
      expect(forked!.ownerUserId).toBe(other);
      expect(forked!.id).not.toBe(chat);

      const copiedMessages = await tenantDb.runAs(other, (tx) =>
        new MessagesRepository(tx).findByChatId(forked!.id, other),
      );
      expect(copiedMessages.length).toBe(2);
      const serialized = JSON.stringify(copiedMessages);
      expect(serialized).not.toContain('PRIVATE_THINKING');
      expect(serialized).not.toContain(owner);
      expect(serialized).toContain('the public answer');

      // Copied "user" turns are attributed to the NEW owner, never the
      // original sender — the public DTO carries no sender identity to copy.
      const userTurn = copiedMessages.find((m) => m.role === 'user');
      expect(userTurn?.senderUserId).toBe(other);
      const assistantTurn = copiedMessages.find((m) => m.role === 'assistant');
      expect(assistantTurn?.senderUserId).toBeNull();

      // The source chat is untouched — a fork never mutates its origin.
      const source = await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).findById(chat, owner),
      );
      expect(source?.visibility).toBe('public');
      const sourceMessages = await tenantDb.runAs(owner, (tx) =>
        new MessagesRepository(tx).findByChatId(chat, owner),
      );
      expect(sourceMessages.length).toBe(2);
    });

    it('the fork lands in the CALLER’s tenancy — the original owner cannot see it (RLS negative, both directions)', async () => {
      const chat = await seedChat('public');
      const forked = await service.forkSharedChat(chat, other);
      expect(forked).toBeDefined();

      // Original owner: not visible via an owner-scoped lookup...
      const asOwner = await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).findById(forked!.id, owner),
      );
      expect(asOwner).toBeUndefined();
      // ...nor via a raw select relying on RLS alone (no app-layer predicate).
      const rawRows = await tenantDb.runAs(owner, (tx) =>
        tx.select().from(chats).where(eq(chats.id, forked!.id)),
      );
      expect(rawRows).toEqual([]);

      // The caller (new owner) CAN see it via their own owner-scoped lookup.
      const asCaller = await tenantDb.runAs(other, (tx) =>
        new ChatsRepository(tx).findById(forked!.id, other),
      );
      expect(asCaller?.id).toBe(forked!.id);
    });

    it('copies a conversation faithfully past the old (now-removed) 500-message cap', async () => {
      const chat = await seedChat('public');
      const total = 550;
      await tenantDb.runAs(owner, async (tx) => {
        const rows: Parameters<MessagesRepository['createMany']>[0] =
          Array.from({ length: total }, (_, i) => ({
            id: crypto.randomUUID(),
            chatId: chat,
            role: i % 2 === 0 ? 'user' : 'assistant',
            senderUserId: i % 2 === 0 ? owner : null,
            parts: [{ type: 'text', text: `turn-${i}` }],
            attachments: [],
            inReplyTo: null,
          }));
        await new MessagesRepository(tx).createMany(rows);
      });

      const forked = await service.forkSharedChat(chat, other);
      expect(forked).toBeDefined();
      const copied = await tenantDb.runAs(other, (tx) =>
        new MessagesRepository(tx).findByChatId(forked!.id, other),
      );
      // +2 from seedChat's own turn pair — nothing dropped, unlike a cap.
      expect(copied.length).toBe(total + 2);
    });
  });
});
