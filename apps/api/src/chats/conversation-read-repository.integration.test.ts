/**
 * Owner-scoped canonical conversation-source lookup (conversation reads, task 4.1).
 *
 * TEST_DATABASE_URL is required; the integration global setup supplies a
 * throwaway FORCE-RLS Postgres database when no external URL is configured.
 * The repository method is deliberately exercised against FORCE-RLS Postgres:
 * an owner predicate in application SQL is not enough because the public-share
 * policy can otherwise make a public row visible from a no-identity transaction.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'conversation-read-repository.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}
type SqlClient = Sql;

describe('conversation source repository lookup', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL, { ssl, max: 5 });
    const db: Db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    for (const id of [ownerA, ownerB]) {
      await sqlClient`
        INSERT INTO users (id, name, email)
        VALUES (${id}, 'Conversation read owner', ${`conversation-read-${id}@test.com`})
      `;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await sqlClient.end();
    }
  });

  async function createChat(ownerUserId: string, title: string) {
    return tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId, title }),
    );
  }

  async function createMessage(
    ownerUserId: string,
    input: {
      chatId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      text: string;
      usage?: unknown;
    },
  ) {
    return tenantDb.runAs(ownerUserId, (tx) => {
      const values: Parameters<MessagesRepository['create']>[0] = {
        chatId: input.chatId,
        role: input.role,
        senderUserId: input.role === 'user' ? ownerUserId : null,
        parts: [{ type: 'text', text: input.text }],
      };
      if (input.usage !== undefined) values.usage = input.usage;
      return new MessagesRepository(tx).create(values);
    });
  }

  it('returns nearest eligible neighbors across ineligible Chat-local rows', async () => {
    const chat = await createChat(ownerA, 'Evidence lookup');
    const interleavedChat = await createChat(ownerA, 'Interleaved sequence');

    try {
      const first = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'user',
        text: 'first',
      });
      const interleaved = await createMessage(ownerA, {
        chatId: interleavedChat.id,
        role: 'user',
        text: 'independent local sequence',
      });
      const completed = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'completed',
        usage: { status: 'completed' },
      });
      const legacy = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'legacy',
        usage: {},
      });
      const retryableNull = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'retryable null',
        usage: { status: null },
      });
      const systemMessage = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'system',
        text: 'hidden system',
        usage: { status: 'completed' },
      });
      const toolMessage = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'tool',
        text: 'hidden tool',
        usage: { status: 'completed' },
      });
      const nextUser = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'user',
        text: 'next user',
        usage: { status: 'error' },
      });
      const retryableError = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'retryable error',
        usage: { status: 'error' },
      });
      const retryableAborted = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'retryable aborted',
        usage: { status: 'aborted' },
      });
      const legacyNull = await createMessage(ownerA, {
        chatId: chat.id,
        role: 'assistant',
        text: 'legacy null usage',
        usage: null,
      });

      const target = await tenantDb.runAs(ownerA, (tx) =>
        new MessagesRepository(tx).findConversationMessage(
          chat.id,
          ownerA,
          legacy.seq,
        ),
      );

      expect(target).toEqual({
        chatId: chat.id,
        seq: legacy.seq,
        role: 'assistant',
        parts: [{ type: 'text', text: 'legacy' }],
        usage: {},
        createdAt: expect.any(Date),
        previousMessageSeq: completed.seq,
        nextMessageSeq: nextUser.seq,
      });
      expect([first.seq, interleaved.seq]).toEqual([1, 1]);
      expect(legacy.seq).toBeGreaterThan(first.seq + 1);
      expect(nextUser.seq).toBeGreaterThan(retryableNull.seq);
      expect(retryableError.seq).toBeGreaterThan(nextUser.seq);

      const firstRead = await tenantDb.runAs(ownerA, (tx) =>
        new MessagesRepository(tx).findConversationMessage(
          chat.id,
          ownerA,
          first.seq,
        ),
      );
      expect(firstRead?.previousMessageSeq).toBeUndefined();
      expect(firstRead?.nextMessageSeq).toBe(completed.seq);

      const lastRead = await tenantDb.runAs(ownerA, (tx) =>
        new MessagesRepository(tx).findConversationMessage(
          chat.id,
          ownerA,
          nextUser.seq,
        ),
      );
      expect(lastRead?.previousMessageSeq).toBe(legacy.seq);
      expect(lastRead?.nextMessageSeq).toBe(legacyNull.seq);

      const legacyNullRead = await tenantDb.runAs(ownerA, (tx) =>
        new MessagesRepository(tx).findConversationMessage(
          chat.id,
          ownerA,
          legacyNull.seq,
        ),
      );
      expect(legacyNullRead?.usage).toBeNull();
      expect(legacyNullRead?.previousMessageSeq).toBe(nextUser.seq);
      expect(legacyNullRead?.nextMessageSeq).toBeUndefined();

      for (const ineligible of [
        retryableNull,
        retryableError,
        retryableAborted,
        systemMessage,
        toolMessage,
      ]) {
        await expect(
          tenantDb.runAs(ownerA, (tx) =>
            new MessagesRepository(tx).findConversationMessage(
              chat.id,
              ownerA,
              ineligible.seq,
            ),
          ),
        ).resolves.toBeUndefined();
      }
    } finally {
      await tenantDb.runAs(ownerA, (tx) =>
        new ChatsRepository(tx).deleteById(chat.id, ownerA),
      );
      await tenantDb.runAs(ownerA, (tx) =>
        new ChatsRepository(tx).deleteById(interleavedChat.id, ownerA),
      );
    }
  });

  it('returns a closed miss for deleted, public, and cross-owner sources', async () => {
    const ownerChat = await createChat(ownerA, 'Private evidence');
    const otherChat = await createChat(ownerB, 'Other owner evidence');

    try {
      const ownerMessage = await createMessage(ownerA, {
        chatId: ownerChat.id,
        role: 'user',
        text: 'owner-only',
      });
      const otherMessage = await createMessage(ownerB, {
        chatId: otherChat.id,
        role: 'user',
        text: 'other-owner-only',
      });
      const deletedMessage = await createMessage(ownerA, {
        chatId: ownerChat.id,
        role: 'user',
        text: 'delete me',
      });

      await tenantDb.runAs(ownerA, (tx) =>
        tx
          .delete(schema.messages)
          .where(eq(schema.messages.id, deletedMessage.id)),
      );

      await expect(
        tenantDb.runAs(ownerA, (tx) =>
          new MessagesRepository(tx).findConversationMessage(
            ownerChat.id,
            ownerA,
            deletedMessage.seq,
          ),
        ),
      ).resolves.toBeUndefined();

      await tenantDb.runAs(ownerA, async (tx) => {
        await new ChatsRepository(tx).update(ownerChat.id, ownerA, {
          visibility: 'public',
        });
      });

      await expect(
        tenantDb.runAsPublic((tx) =>
          new MessagesRepository(tx).findConversationMessage(
            ownerChat.id,
            ownerA,
            ownerMessage.seq,
          ),
        ),
      ).resolves.toBeUndefined();

      await expect(
        tenantDb.runAs(ownerB, (tx) =>
          new MessagesRepository(tx).findConversationMessage(
            ownerChat.id,
            ownerA,
            ownerMessage.seq,
          ),
        ),
      ).resolves.toBeUndefined();
      await expect(
        tenantDb.runAs(ownerA, (tx) =>
          new MessagesRepository(tx).findConversationMessage(
            otherChat.id,
            ownerB,
            otherMessage.seq,
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await tenantDb.runAs(ownerA, (tx) =>
        new ChatsRepository(tx).deleteById(ownerChat.id, ownerA),
      );
      await tenantDb.runAs(ownerB, (tx) =>
        new ChatsRepository(tx).deleteById(otherChat.id, ownerB),
      );
    }
  });
});
