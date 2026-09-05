/**
 * Time-range search and timeline discovery integration tests (#198).
 * Requires a real PostgreSQL connection (TEST_DATABASE_URL) with the
 * projection tables provisioned.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { SearchIndexService } from '../search/search-index.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { timelineByOwner } from './chats-timeline-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb(
  'time-range search and timeline — searchByOwner + timelineByOwner (#198)',
  () => {
    let sqlClient: Sql;
    let db: Db;
    let tenantDb: TenantDbService;
    let indexService: SearchIndexService;
    let userA: string;
    let userB: string;

    const owned: Array<{ id: string; owner: string }> = [];

    async function seedChat(
      owner: string,
      title: string | null,
      msgs: Array<{
        role: 'user' | 'assistant' | 'system' | 'tool';
        text: string;
        createdAt: Date;
        usage?: unknown;
      }>,
    ): Promise<string> {
      const id = crypto.randomUUID();
      await tenantDb.runAs(owner, async (tx) => {
        const chats = new ChatsRepository(tx);
        const messages = new MessagesRepository(tx);
        const createInput: Parameters<typeof chats.createIfAbsent>[0] = {
          id,
          ownerUserId: owner,
        };
        if (title !== null) createInput.title = title;
        await chats.createIfAbsent(createInput);
        for (const m of msgs) {
          const msg = await messages.create({
            chatId: id,
            role: m.role,
            senderUserId: m.role === 'user' ? owner : null,
            parts: text(m.text),
            usage: m.usage,
          });
          // Backdate the message to the specified timestamp.
          await tx.execute(
            sql`UPDATE messages SET created_at = ${m.createdAt.toISOString()}::timestamptz WHERE id = ${msg.id}`,
          );
        }
      });
      owned.push({ id, owner });
      return id;
    }

    // Fixed dates for deterministic testing.
    const JAN_15 = new Date('2026-01-15T12:00:00Z');
    const FEB_01 = new Date('2026-02-01T12:00:00Z');
    const FEB_15 = new Date('2026-02-15T12:00:00Z');
    const MAR_01 = new Date('2026-03-01T12:00:00Z');

    let inRangeChat: string;
    let outOfRangeChat: string;
    let titleOnlyWithEligibleInRange: string;
    let titleOnlyNoEligibleInRange: string;
    let systemOnlyInRange: string;
    let retryableAssistantOnly: string;
    let publicChatA: string;

    beforeAll(async () => {
      const postgres = await import('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sqlClient = connect(TEST_DB_URL!, { ssl, max: 3 });
      db = drizzle(sqlClient, { schema });
      tenantDb = new TenantDbService(db);
      indexService = new SearchIndexService(tenantDb);
      userA = crypto.randomUUID();
      userB = crypto.randomUUID();
      for (const id of [userA, userB]) {
        await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'S', ${`s-${id}@t.com`})`;
      }

      // Chat with "database" keyword, messages in Feb (inside range Feb-Mar).
      inRangeChat = await seedChat(userA, 'Database migration', [
        {
          role: 'user',
          text: 'how do I run database migrations',
          createdAt: FEB_15,
        },
        {
          role: 'assistant',
          text: 'run pnpm db:migrate',
          createdAt: FEB_15,
        },
      ]);

      // Chat with "database" keyword, messages in Jan (outside range Feb-Mar).
      outOfRangeChat = await seedChat(userA, 'Database setup', [
        {
          role: 'user',
          text: 'database connection string setup',
          createdAt: JAN_15,
        },
        {
          role: 'assistant',
          text: 'set POSTGRES_URL in .env',
          createdAt: JAN_15,
        },
      ]);

      // Title matches "database" and has an eligible message in range.
      titleOnlyWithEligibleInRange = await seedChat(userA, 'Database tips', [
        {
          role: 'user',
          text: 'general question',
          createdAt: FEB_15,
        },
      ]);

      // Title matches "database" but only message is in Jan (out of range).
      titleOnlyNoEligibleInRange = await seedChat(userA, 'Database old notes', [
        {
          role: 'user',
          text: 'old notes about something',
          createdAt: JAN_15,
        },
      ]);

      // Chat with only system/tool messages in range — should be excluded.
      systemOnlyInRange = await seedChat(userA, 'System chat', [
        {
          role: 'system',
          text: 'system prompt about database',
          createdAt: FEB_15,
        },
        {
          role: 'tool',
          text: 'tool output about database',
          createdAt: FEB_15,
        },
      ]);

      // Chat with only a retryable assistant message (not completed) in range.
      retryableAssistantOnly = await seedChat(
        userA,
        'Retryable database chat',
        [
          {
            role: 'user',
            text: 'database question',
            createdAt: JAN_15,
          },
          {
            role: 'assistant',
            text: 'partial answer about database',
            createdAt: FEB_15,
            usage: { status: 'error' },
          },
        ],
      );

      // A's public chat — for identity guard test.
      publicChatA = await seedChat(userA, 'Public database chat', [
        {
          role: 'user',
          text: 'public database question',
          createdAt: FEB_15,
        },
      ]);
      await tenantDb.runAs(userA, async (tx) => {
        await tx.execute(
          sql`UPDATE chats SET visibility = 'public' WHERE id = ${publicChatA}`,
        );
      });

      // B's chats (cross-tenant control).
      await seedChat(userB, 'B database chat', [
        {
          role: 'user',
          text: 'B database question',
          createdAt: FEB_15,
        },
      ]);

      // Reindex all seeded chats.
      for (const { id, owner } of owned) {
        await indexService.reindexChat(id, owner);
      }
    });

    afterAll(async () => {
      if (sqlClient) {
        for (const id of [userA, userB]) {
          await sqlClient`DELETE FROM users WHERE id = ${id}`;
        }
        await sqlClient.end();
      }
    });

    // --- Task 1.4: required range ---

    it('required range excludes an out-of-range exact match', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'required',
          },
        }),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(inRangeChat);
      expect(ids).not.toContain(outOfRangeChat);
    });

    it('required range includes a title-only match when it has an eligible message in range', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'required',
          },
        }),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(titleOnlyWithEligibleInRange);
      expect(ids).not.toContain(titleOnlyNoEligibleInRange);
    });

    it('one-sided after applies exactly one clause', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            constraint: 'required',
          },
        }),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(inRangeChat);
      expect(ids).not.toContain(outOfRangeChat);
    });

    it('one-sided before applies exactly one clause', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            before: FEB_01,
            constraint: 'required',
          },
        }),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(outOfRangeChat);
      expect(ids).not.toContain(inRangeChat);
    });

    // --- Task 1.5: preferred range ---

    it('preferred range keeps the exact out-of-range match in the results', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'preferred',
          },
        }),
      );
      const ids = results.map((r) => r.id);
      expect(ids).toContain(outOfRangeChat);
      expect(ids).toContain(inRangeChat);
    });

    it('preferred range ranks an in-range near-tie ahead of an out-of-range one', async () => {
      const results = await tenantDb.runAs(userA, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'preferred',
          },
        }),
      );
      const inRangeIdx = results.findIndex((r) => r.id === inRangeChat);
      const outOfRangeIdx = results.findIndex((r) => r.id === outOfRangeChat);
      expect(inRangeIdx).toBeLessThan(outOfRangeIdx);
    });

    // --- Task 1.6: timelineByOwner ---

    it('timeline returns activity pointers for chats with eligible messages in range', async () => {
      const regions = await tenantDb.runAs(userA, (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      const chatIds = regions.map((r) => r.chatId);
      expect(chatIds).toContain(inRangeChat);
      expect(chatIds).toContain(titleOnlyWithEligibleInRange);
      expect(chatIds).not.toContain(outOfRangeChat);
    });

    it('timeline excludes chats whose only in-range rows are system, tool, or retryable assistant', async () => {
      const regions = await tenantDb.runAs(userA, (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      const chatIds = regions.map((r) => r.chatId);
      expect(chatIds).not.toContain(systemOnlyInRange);
      expect(chatIds).not.toContain(retryableAssistantOnly);
    });

    it('timeline messageCount and sequences match the seeded data', async () => {
      const regions = await tenantDb.runAs(userA, (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      const inRangeRegion = regions.find((r) => r.chatId === inRangeChat);
      expect(inRangeRegion).toBeDefined();
      expect(inRangeRegion!.messageCount).toBe(2);
      expect(inRangeRegion!.firstSeq).toBeLessThanOrEqual(
        inRangeRegion!.lastSeq,
      );
      expect(inRangeRegion!.firstActivityAt).toBeInstanceOf(Date);
      expect(inRangeRegion!.lastActivityAt).toBeInstanceOf(Date);
    });

    // --- Task 1.7: timestamps only from messages, not chat metadata ---

    it('a chat retitled inside the range with all eligible messages outside it is absent', async () => {
      // Create a chat with messages in Jan, then retitle it in Feb.
      const retitledChat = await seedChat(userA, 'Old title', [
        {
          role: 'user',
          text: 'old message',
          createdAt: JAN_15,
        },
      ]);
      // Update title (bumps updatedAt into Feb).
      await tenantDb.runAs(userA, async (tx) => {
        await tx.execute(
          sql`UPDATE chats SET title = 'Retitled in Feb', updated_at = ${FEB_15.toISOString()}::timestamptz WHERE id = ${retitledChat}`,
        );
      });

      const regions = await tenantDb.runAs(userA, (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      expect(regions.map((r) => r.chatId)).not.toContain(retitledChat);
    });

    // --- Task 1.8: RLS negatives ---

    it('user B requesting user A as owner through required-range search gets no results', async () => {
      const results = await tenantDb.runAs(userB, (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'required',
          },
        }),
      );
      expect(results).toEqual([]);
    });

    it('user B requesting user A as owner through timeline gets no regions', async () => {
      const regions = await tenantDb.runAs(userB, (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      expect(regions).toEqual([]);
    });

    it('empty-identity timeline returns zero regions even with a real owner id and a public chat', async () => {
      const regions = await tenantDb.runAsPublic(async (tx) =>
        timelineByOwner(tx, userA, {
          after: FEB_01,
          before: MAR_01,
          limit: 50,
        }),
      );
      expect(regions).toEqual([]);
    });

    it('empty-identity required-range search returns no results even with a real owner id', async () => {
      const results = await tenantDb.runAsPublic(async (tx) =>
        new ChatsRepository(tx).searchByOwner(userA, 'database', {
          limit: 20,
          timeRange: {
            after: FEB_01,
            before: MAR_01,
            constraint: 'required',
          },
        }),
      );
      expect(results).toEqual([]);
    });
  },
);
