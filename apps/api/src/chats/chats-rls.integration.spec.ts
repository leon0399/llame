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
 * - RLS ENABLED *and* FORCED on chats, messages, compactions, runs, and run_events
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
import { SessionsRepository } from '../auth/sessions.repository';
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
    // max: 2 (not 1) so beforeAll/afterAll raw-sql cleanup never deadlocks against a
    // still-open runAs transaction — with a single pooled connection, a tx left open
    // by a failing test would block afterAll's DELETE and hang the process in CI.
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    // Drizzle client over the same pool — used to round-trip through the actual
    // production repository code path (not hand-rolled SQL).
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

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on chats, messages, compactions, runs, and run_events', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    // A superuser or BYPASSRLS role would make every assertion below vacuous.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('chats', 'messages', 'compactions', 'runs', 'run_events')
      ORDER BY relname`;
    expect(rows.length).toBe(5);
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

  // #86 — createIfAbsent powers "first message creates the chat". Prove its semantics under
  // FORCE RLS: first create returns the row (WITH CHECK passes for the current tenant); any id
  // reuse — same tenant OR cross-tenant — conflicts on the PK and returns undefined, so a
  // second tenant can never hijack an already-claimed id.
  it('createIfAbsent: row on first create, undefined on id reuse incl. cross-tenant', async () => {
    const chatId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(
        dsql`select set_config('app.current_user_id', ${userAId}, true)`,
      );
      const repo = new ChatsRepository(tx);

      const created = await repo.createIfAbsent({
        id: chatId,
        ownerUserId: userAId,
        title: 'First',
      });
      expect(created?.id).toBe(chatId);
      expect(created?.ownerUserId).toBe(userAId);

      // Same id again (still A) → conflict → undefined, no duplicate.
      expect(
        await repo.createIfAbsent({ id: chatId, ownerUserId: userAId }),
      ).toBeUndefined();
    });

    try {
      // B cannot hijack A's id: PK conflict → undefined, and B still cannot read it.
      await db.transaction(async (tx) => {
        await tx.execute(
          dsql`select set_config('app.current_user_id', ${userBId}, true)`,
        );
        const repo = new ChatsRepository(tx);
        expect(
          await repo.createIfAbsent({ id: chatId, ownerUserId: userBId }),
        ).toBeUndefined();
        expect(await repo.findById(chatId, userBId)).toBeUndefined();
      });

      // The chat is unchanged: still owned by A.
      await db.transaction(async (tx) => {
        await tx.execute(
          dsql`select set_config('app.current_user_id', ${userAId}, true)`,
        );
        const repo = new ChatsRepository(tx);
        const mine = await repo.findById(chatId, userAId);
        expect(mine?.ownerUserId).toBe(userAId);
      });
    } finally {
      await asUser(userAId, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`);
    }
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
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

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

      const [readBack] = await messagesRepo.findByChatId(chat.id, userAId);
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

  // #57 — compaction summaries condense private conversation content, so they carry
  // the same tenant boundary as the messages they supersede.
  it('compactions cross-tenant: B cannot read A compactions, nor write into A chats', async () => {
    const chatId = crypto.randomUUID();
    const compactionId = crypto.randomUUID();

    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Long Chat')`;
      await tx`
        INSERT INTO compactions (id, chat_id, upto_seq, summary)
        VALUES (${compactionId}, ${chatId}, 10, 'private summary')`;
    });
    try {
      // Read denial: zero rows for another tenant.
      const rows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM compactions WHERE id = ${compactionId}`,
      );
      expect(rows.length).toBe(0);

      // Write denial: the policy's implicit WITH CHECK rejects an insert whose
      // chat_id belongs to another tenant (fail closed, not silently open).
      await expect(
        asUser(
          userBId,
          (tx) => tx`
            INSERT INTO compactions (chat_id, upto_seq, summary)
            VALUES (${chatId}, 20, 'forged summary')`,
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    } finally {
      await asUser(userAId, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`); // cascades to compactions
    }
  });

  // #68 — session housekeeping: deleteExpired purges expired/idle rows and
  // leaves live sessions alone. Cross-user by design (sessions carry no RLS —
  // they are consulted pre-authentication; expiry is a global fact).
  it('deleteExpired purges expired sessions and keeps live ones', async () => {
    const repo = new SessionsRepository(db);

    const live = await repo.create({
      userId: userAId,
      tokenHash: `live-${crypto.randomUUID()}`,
      expires: new Date(Date.now() + 60_000),
    });
    const expired = await repo.create({
      userId: userAId,
      tokenHash: `expired-${crypto.randomUUID()}`,
      expires: new Date(Date.now() - 60_000),
    });

    try {
      const purged = await repo.deleteExpired(7 * 24 * 60 * 60 * 1000);
      expect(purged).toBeGreaterThanOrEqual(1);

      // Assert PHYSICAL deletion via the raw table — listForUser filters
      // expired rows anyway, so it would pass even if the delete no-opped.
      const rawRows = await sql`
        SELECT id FROM sessions WHERE id IN (${live.id}, ${expired.id})`;
      const rawIds = rawRows.map((r) => (r as { id: string }).id);
      expect(rawIds).toContain(live.id);
      expect(rawIds).not.toContain(expired.id);
    } finally {
      await repo.deleteByIdForUser(userAId, live.id);
      await repo.deleteByIdForUser(userAId, expired.id);
    }
  });

  // #73 — DB-level in_reply_to integrity: the trigger (migration 0014) rejects

  // #73 — DB-level in_reply_to integrity: the trigger (migration 0013) rejects
  // a reply linked across chats or to a non-user message, no matter which code
  // path writes it. The app enforces this in findTurnState; the DB now does too.
  it('in_reply_to must reference a user message in the same chat (trigger)', async () => {
    const chatOne = crypto.randomUUID();
    const chatTwo = crypto.randomUUID();
    const userMsgInOne = crypto.randomUUID();
    const assistantMsgInOne = crypto.randomUUID();

    try {
      // Arrange inside the try: if a trigger regression rejects even the VALID
      // seed reply below, the finally still removes whatever was created —
      // leaked chats/messages would poison later whole-tenant assertions.
      await asUser(userAId, async (tx) => {
        await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatOne}, ${userAId}, 'One')`;
        await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatTwo}, ${userAId}, 'Two')`;
        await tx`
          INSERT INTO messages (id, chat_id, role, sender_user_id, parts)
          VALUES (${userMsgInOne}, ${chatOne}, 'user', ${userAId}, '[]')`;
        await tx`
          INSERT INTO messages (id, chat_id, role, parts, in_reply_to)
          VALUES (${assistantMsgInOne}, ${chatOne}, 'assistant', '[]', ${userMsgInOne})`;
      });
      // Valid reply (same chat, user-role target) was accepted above. Now the
      // two invalid shapes, both as the OWNING tenant — this is an integrity
      // constraint, not an isolation one.
      await expect(
        asUser(
          userAId,
          (tx) => tx`
            INSERT INTO messages (id, chat_id, role, parts, in_reply_to)
            VALUES (${crypto.randomUUID()}, ${chatTwo}, 'assistant', '[]', ${userMsgInOne})`,
        ),
      ).rejects.toThrow(/user message in the same chat/i);

      await expect(
        asUser(
          userAId,
          (tx) => tx`
            INSERT INTO messages (id, chat_id, role, parts, in_reply_to)
            VALUES (${crypto.randomUUID()}, ${chatOne}, 'assistant', '[]', ${assistantMsgInOne})`,
        ),
      ).rejects.toThrow(/user message in the same chat/i);
    } finally {
      await asUser(userAId, async (tx) => {
        await tx`DELETE FROM chats WHERE id IN (${chatOne}, ${chatTwo})`;
      });
    }
  });

  // #48 — runs/run_events record execution over private conversation content;
  // same tenant boundary as the chat they belong to.
  it('runs/run_events cross-tenant: B cannot read A runs or events, nor write into them', async () => {
    const chatId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'Run Chat')`;
      await tx`INSERT INTO runs (id, chat_id, user_id) VALUES (${runId}, ${chatId}, ${userAId})`;
      await tx`INSERT INTO run_events (run_id, event_type, payload) VALUES (${runId}, 'run.created', '{"private": true}')`;
    });
    try {
      const runRows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM runs WHERE id = ${runId}`,
      );
      expect(runRows.length).toBe(0);

      const eventRows = await asUser(
        userBId,
        (tx) => tx`SELECT sequence FROM run_events WHERE run_id = ${runId}`,
      );
      expect(eventRows.length).toBe(0);

      // Write denial: B cannot forge events onto A's run (fail closed).
      await expect(
        asUser(
          userBId,
          (tx) => tx`
            INSERT INTO run_events (run_id, event_type)
            VALUES (${runId}, 'run.forged')`,
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    } finally {
      await asUser(userAId, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`); // cascades to runs → run_events
    }
  });
});

/**
 * Service-level RLS integration — proves the APP layer (ChatsService via
 * TenantDbService.runAs) correctly engages RLS for tenant isolation.
 *
 * This is the acceptance criterion: "ChatsService.createChat({ownerUserId: A})
 * succeeds; listChatsWithLastMessage(A) returns it; listChatsWithLastMessage(B)
 * returns zero of A's chats (and none of A's message previews)."
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
      // max: 2 (see first describe block) so afterAll cleanup can't deadlock against
      // an open transaction on a single pooled connection.
      sql = connect(TEST_DB_URL!, { ssl, max: 2 });
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

    it('createChat + listChatsWithLastMessage(A) returns the chat created by A', async () => {
      const chat = await svc.createChat({
        ownerUserId: userAId,
        title: 'Service Chat A',
      });

      expect(chat.id).toBeDefined();
      expect(chat.ownerUserId).toBe(userAId);

      const aChats = await svc.listChatsWithLastMessage(userAId);
      const found = aChats.find((c) => c.chat.id === chat.id);
      expect(found).toBeDefined();
      expect(found?.chat.ownerUserId).toBe(userAId);
    });

    it('listChatsWithLastMessage(B) returns zero of A chats or messages (cross-tenant isolation via runAs)', async () => {
      const chat = await svc.createChat({
        ownerUserId: userAId,
        title: 'A-Only Chat',
      });

      // Write a message into A's chat so the latest-message preview join has
      // an actual row to (wrongly) surface if isolation ever regressed.
      await db.transaction(async (tx) => {
        await tx.execute(
          dsql`select set_config('app.current_user_id', ${userAId}, true)`,
        );
        await new MessagesRepository(tx).create({
          id: crypto.randomUUID(),
          chatId: chat.id,
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'A-only secret preview' }],
          attachments: [],
        });
      });

      // A sees the chat with its preview — the join is actually exercised.
      const aChats = await svc.listChatsWithLastMessage(userAId);
      const aItem = aChats.find((c) => c.chat.id === chat.id);
      expect(aItem?.lastMessage?.parts).toEqual([
        { type: 'text', text: 'A-only secret preview' },
      ]);

      const bChats = await svc.listChatsWithLastMessage(userBId);
      const leakedChat = bChats.find((c) => c.chat.id === chat.id);

      // B must not see A's chat row via the service.
      expect(leakedChat).toBeUndefined();

      // The service can mask a repository leak (it only looks up previews for
      // B's own chat ids), so prove the message scoping at the repository
      // boundary directly: under B's RLS context, the latest-per-chat query
      // must not return A's message.
      const bLatest = await db.transaction(async (tx) => {
        await tx.execute(
          dsql`select set_config('app.current_user_id', ${userBId}, true)`,
        );
        return new MessagesRepository(tx).findLatestPerOwnedChat(userBId);
      });
      expect(bLatest.find((m) => m.chatId === chat.id)).toBeUndefined();
    });

    it('getChatMessages returns owned history but hides the same chat from another user', async () => {
      const chat = await svc.createChat({
        ownerUserId: userAId,
        title: 'History Chat',
      });

      await db.transaction(async (tx) => {
        await tx.execute(
          dsql`select set_config('app.current_user_id', ${userAId}, true)`,
        );
        const messagesRepo = new MessagesRepository(tx);
        const userMessageId = crypto.randomUUID();
        await messagesRepo.create({
          id: userMessageId,
          chatId: chat.id,
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'First' }],
          attachments: [{ type: 'file', name: 'context.txt' }],
        });
        await messagesRepo.create({
          id: crypto.randomUUID(),
          chatId: chat.id,
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'Second' }],
          attachments: [],
          usage: { status: 'completed', cachedInputTokens: 1 },
          inReplyTo: userMessageId,
        });
      });

      const aMessages = await svc.getChatMessages(chat.id, userAId, {
        limit: 100,
      });
      expect(aMessages).toHaveLength(2);
      expect(aMessages?.[0]).toEqual(
        expect.objectContaining({
          chatId: chat.id,
          seq: expect.any(Number),
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'First' }],
          attachments: [{ type: 'file', name: 'context.txt' }],
          usage: null,
          inReplyTo: null,
        }),
      );
      expect(aMessages?.[1]).toEqual(
        expect.objectContaining({
          chatId: chat.id,
          seq: expect.any(Number),
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'Second' }],
          attachments: [],
          usage: { status: 'completed', cachedInputTokens: 1 },
          inReplyTo: aMessages?.[0]?.id,
        }),
      );
      expect(aMessages?.[0]?.seq).toBeLessThan(aMessages?.[1]?.seq ?? 0);

      const bMessages = await svc.getChatMessages(chat.id, userBId, {
        limit: 100,
      });
      expect(bMessages).toBeUndefined();
    });
  },
);
