/**
 * Canonical search hydration against the owner-scoped projection and message
 * tables. The projection is only a locator: every returned byte must come from
 * the current eligible canonical message rows.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { z } from 'zod';

import * as schema from '../../db/schema';
import { TenantDbService } from '../../db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from '../../chats/chats-repository';
import { CHUNKER_VERSION } from './conversation-chunker';
import {
  hydrateCanonicalSearchCandidate,
  type HydratedCanonicalSearchDocument,
} from './canonical-search-hydrator';
import { SearchIndexService } from '../search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;

type SeedMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: Array<unknown>;
  usage?: unknown;
};

describeIfDb('canonical search hydration', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let ownerA: string;
  let ownerB: string;

  const textPart = (text: string) => ({ type: 'text', text });

  async function seedChat(
    ownerUserId: string,
    seedMessages: ReadonlyArray<SeedMessage>,
  ): Promise<{ chatId: string; messageIds: Array<string> }> {
    const chatId = crypto.randomUUID();
    const messageIds: Array<string> = [];
    await tenantDb.runAs(ownerUserId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({
        id: chatId,
        ownerUserId,
        title: 'Canonical hydration',
      });
      for (const seedMessage of seedMessages) {
        const created = await messages.create({
          chatId,
          role: seedMessage.role,
          senderUserId: seedMessage.role === 'user' ? ownerUserId : null,
          parts: seedMessage.parts,
          usage: seedMessage.usage,
        });
        messageIds.push(created.id);
      }
    });
    return { chatId, messageIds };
  }

  async function documentIdsAs(
    ownerUserId: string,
    chatId: string,
  ): Promise<Array<string>> {
    const rows = await tenantDb.runAs(ownerUserId, (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT id
        FROM search_chat_documents
        WHERE chat_id = ${chatId}
        ORDER BY chunk_ordinal
      `),
    );
    return [...rows].map((row) => row.id);
  }

  async function hydrateAs(
    ownerUserId: string,
    chatId: string,
    documentId: string,
  ): Promise<HydratedCanonicalSearchDocument | null> {
    return tenantDb.runAs(ownerUserId, (tx) =>
      hydrateCanonicalSearchCandidate(tx, ownerUserId, {
        chatId,
        bestDocumentId: documentId,
      }),
    );
  }

  async function updateDocument(
    ownerUserId: string,
    documentId: string,
    statement: ReturnType<typeof sql>,
  ): Promise<void> {
    await tenantDb.runAs(ownerUserId, (tx) => tx.execute(statement));
  }

  async function firstDocumentId(
    ownerUserId: string,
    chatId: string,
  ): Promise<string> {
    const [row] = await tenantDb.runAs(ownerUserId, (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT id
        FROM search_chat_documents
        WHERE chat_id = ${chatId}
        ORDER BY chunk_ordinal
        LIMIT 1
      `),
    );
    return z.string().parse(row?.id);
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 5 });
    tenantDb = new TenantDbService(drizzle(sqlClient, { schema }));
    indexService = new SearchIndexService(tenantDb);
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    for (const id of [ownerA, ownerB]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'Hydration', ${`hydration-${id}@test.com`})`;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await sqlClient.end();
    }
  });

  it('hydrates partial boundaries, complete intermediates, and all visible text parts', async () => {
    const firstText = 'first visible\n\nsecond visible';
    const lastText = 'last\r\nline';
    const seeded = await seedChat(ownerA, [
      {
        role: 'user',
        parts: [
          textPart('first visible'),
          { type: 'reasoning', text: 'hidden reasoning' },
          textPart('second visible'),
        ],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'hidden assistant reasoning' },
          textPart('complete intermediate'),
          { type: 'tool-search', output: 'hidden tool result' },
        ],
        usage: { status: 'completed' },
      },
      { role: 'user', parts: [textPart(lastText)] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);

    const firstOffset = 6;
    const lastOffset = 'last\r\n'.length;
    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_id = ${seeded.messageIds[0]},
            last_message_id = ${seeded.messageIds[2]},
            first_message_text_offset = ${firstOffset},
            last_message_text_offset_exclusive = ${lastOffset}
        WHERE id = ${documentId}
      `,
    );

    await expect(hydrateAs(ownerA, seeded.chatId, documentId)).resolves.toEqual(
      {
        chatId: seeded.chatId,
        messages: [
          {
            messageSeq: expect.any(Number),
            role: 'user',
            timestamp: expect.any(Date),
            visibleText: firstText,
            sourceStart: firstOffset,
            sourceEndExclusive: firstText.length,
          },
          {
            messageSeq: expect.any(Number),
            role: 'assistant',
            timestamp: expect.any(Date),
            visibleText: 'complete intermediate',
            sourceStart: 0,
            sourceEndExclusive: 'complete intermediate'.length,
          },
          {
            messageSeq: expect.any(Number),
            role: 'user',
            timestamp: expect.any(Date),
            visibleText: lastText,
            sourceStart: 0,
            sourceEndExclusive: lastOffset,
          },
        ],
      },
    );
  });

  it('hydrates a same-message UTF-16 range without exposing projection identity', async () => {
    const visibleText = 'A😀BC';
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart(visibleText)] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);
    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_text_offset = 1,
            last_message_text_offset_exclusive = 3
        WHERE id = ${documentId}
      `,
    );

    const result = await hydrateAs(ownerA, seeded.chatId, documentId);
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]).toMatchObject({
      messageSeq: expect.any(Number),
      visibleText,
      sourceStart: 1,
      sourceEndExclusive: 3,
    });
    expect(result?.messages[0]).not.toHaveProperty('messageId');
    expect(result?.messages[0]).not.toHaveProperty('partId');
    expect(result?.messages[0]).not.toHaveProperty('contentHash');
  });

  it('returns a closed miss for zero-width first, last, and same-message ranges', async () => {
    const multi = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('first source')] },
      { role: 'user', parts: [textPart('last source')] },
    ]);
    await indexService.reindexChat(multi.chatId, ownerA);
    const multiDocumentId = await firstDocumentId(ownerA, multi.chatId);

    await updateDocument(
      ownerA,
      multiDocumentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_text_offset = ${'first source'.length}
        WHERE id = ${multiDocumentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, multi.chatId, multiDocumentId),
    ).resolves.toBeNull();

    await indexService.reindexChat(multi.chatId, ownerA);
    await updateDocument(
      ownerA,
      multiDocumentId,
      sql`
        UPDATE search_chat_documents
        SET last_message_text_offset_exclusive = 0
        WHERE id = ${multiDocumentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, multi.chatId, multiDocumentId),
    ).resolves.toBeNull();

    const same = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('same source')] },
    ]);
    await indexService.reindexChat(same.chatId, ownerA);
    const sameDocumentId = await firstDocumentId(ownerA, same.chatId);
    await updateDocument(
      ownerA,
      sameDocumentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_text_offset = 3,
            last_message_text_offset_exclusive = 3
        WHERE id = ${sameDocumentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, same.chatId, sameDocumentId),
    ).resolves.toBeNull();
  });

  it('omits an eligible empty intermediate message from the hydrated interval', async () => {
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('visible first')] },
      {
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'hidden only' }],
        usage: { status: 'completed' },
      },
      { role: 'user', parts: [textPart('visible last')] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);

    const result = await hydrateAs(ownerA, seeded.chatId, documentId);
    expect(result?.messages).toHaveLength(2);
    expect(result?.messages.map((message) => message.visibleText)).toEqual([
      'visible first',
      'visible last',
    ]);
    expect(result?.messages.map((message) => message.messageSeq)).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('omits persisted tool and system rows in the interior but rejects them as boundaries', async () => {
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('visible user')] },
      { role: 'tool', parts: [textPart('hidden tool payload')] },
      { role: 'system', parts: [textPart('hidden system prompt')] },
      {
        role: 'assistant',
        parts: [textPart('visible assistant')],
        usage: { status: 'completed' },
      },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);

    const result = await hydrateAs(ownerA, seeded.chatId, documentId);
    expect(result?.messages.map((message) => message.visibleText)).toEqual([
      'visible user',
      'visible assistant',
    ]);

    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_id = ${seeded.messageIds[1]},
            first_message_text_offset = 0
        WHERE id = ${documentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();

    await indexService.reindexChat(seeded.chatId, ownerA);
    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET last_message_id = ${seeded.messageIds[2]},
            last_message_text_offset_exclusive = 0
        WHERE id = ${documentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();
  });

  it('returns a closed miss when a present assistant interior becomes retryable', async () => {
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('stable question')] },
      {
        role: 'assistant',
        parts: [textPart('stable answer')],
        usage: { status: 'completed' },
      },
      { role: 'user', parts: [textPart('follow-up')] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.not.toBeNull();

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE messages
        SET usage = '{"status":"error"}'::jsonb
        WHERE id = ${seeded.messageIds[1]}
      `),
    );
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();
  });

  it('returns a closed miss when a zero-visible message is a projection boundary', async () => {
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('visible first')] },
      {
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'hidden only' }],
        usage: { status: 'completed' },
      },
      { role: 'user', parts: [textPart('visible last')] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);

    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET first_message_id = ${seeded.messageIds[1]},
            first_message_text_offset = 0
        WHERE id = ${documentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();

    await indexService.reindexChat(seeded.chatId, ownerA);
    await updateDocument(
      ownerA,
      documentId,
      sql`
        UPDATE search_chat_documents
        SET last_message_id = ${seeded.messageIds[1]},
            last_message_text_offset_exclusive = 0
        WHERE id = ${documentId}
      `,
    );
    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();
  });

  it('hydrates every overlapping oversized document from raw source text', async () => {
    const userText = `${'user '.repeat(900)}tail`;
    const assistantText = `${'assistant '.repeat(900)}tail`;
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart(userText)] },
      {
        role: 'assistant',
        parts: [
          textPart(assistantText),
          { type: 'reasoning', text: 'not source' },
          { type: 'tool-search', output: 'not source' },
        ],
        usage: { status: 'completed' },
      },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);

    const documentIds = await documentIdsAs(ownerA, seeded.chatId);
    expect(documentIds.length).toBeGreaterThan(1);
    const hydrated = await Promise.all(
      documentIds.map((documentId) =>
        hydrateAs(ownerA, seeded.chatId, documentId),
      ),
    );
    expect(hydrated.every((document) => document !== null)).toBe(true);
    const sourceMessages = hydrated.flatMap(
      (document) => document?.messages ?? [],
    );
    expect(
      sourceMessages.some((message) => message.visibleText === userText),
    ).toBe(true);
    expect(
      sourceMessages.some((message) => message.visibleText === assistantText),
    ).toBe(true);
    expect(
      sourceMessages.every(
        (message) => !message.visibleText.includes('[context:'),
      ),
    ).toBe(true);
    expect(
      sourceMessages.every(
        (message) =>
          message.sourceStart >= 0 &&
          message.sourceEndExclusive <= message.visibleText.length,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'offsetless',
      async (chatId: string, documentId: string) =>
        updateDocument(
          ownerA,
          documentId,
          sql`UPDATE search_chat_documents SET first_message_text_offset = NULL WHERE id = ${documentId}`,
        ),
    ],
    [
      'wrong version',
      async (_chatId: string, documentId: string) =>
        updateDocument(
          ownerA,
          documentId,
          sql`UPDATE search_chat_documents SET chunker_version = ${CHUNKER_VERSION - 1} WHERE id = ${documentId}`,
        ),
    ],
    [
      'invalid offset',
      async (_chatId: string, documentId: string) =>
        updateDocument(
          ownerA,
          documentId,
          sql`UPDATE search_chat_documents SET last_message_text_offset_exclusive = 999999999 WHERE id = ${documentId}`,
        ),
    ],
  ])('returns a closed miss for %s projection state', async (_name, mutate) => {
    const seeded = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('stable source')] },
    ]);
    await indexService.reindexChat(seeded.chatId, ownerA);
    const documentId = await firstDocumentId(ownerA, seeded.chatId);
    await mutate(seeded.chatId, documentId);

    await expect(
      hydrateAs(ownerA, seeded.chatId, documentId),
    ).resolves.toBeNull();
  });

  it('returns a closed miss for retryable, deleted, foreign, or out-of-order sources', async () => {
    const retryable = await seedChat(ownerA, [
      {
        role: 'assistant',
        parts: [textPart('may be replaced')],
        usage: { status: 'completed' },
      },
    ]);
    await indexService.reindexChat(retryable.chatId, ownerA);
    const retryDocument = await firstDocumentId(ownerA, retryable.chatId);
    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE messages SET usage = '{"status":"error"}'::jsonb
        WHERE id = ${retryable.messageIds[0]}
      `),
    );
    await expect(
      hydrateAs(ownerA, retryable.chatId, retryDocument),
    ).resolves.toBeNull();

    const deleted = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('deleted source')] },
    ]);
    await indexService.reindexChat(deleted.chatId, ownerA);
    const deletedDocument = await firstDocumentId(ownerA, deleted.chatId);
    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`DELETE FROM messages WHERE id = ${deleted.messageIds[0]}`),
    );
    await expect(
      hydrateAs(ownerA, deleted.chatId, deletedDocument),
    ).resolves.toBeNull();

    const foreign = await seedChat(ownerB, [
      { role: 'user', parts: [textPart('foreign source')] },
    ]);
    const owned = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('owned source')] },
    ]);
    await indexService.reindexChat(foreign.chatId, ownerB);
    await indexService.reindexChat(owned.chatId, ownerA);
    const ownedDocument = await firstDocumentId(ownerA, owned.chatId);
    await updateDocument(
      ownerA,
      ownedDocument,
      sql`
        UPDATE search_chat_documents
        SET first_message_id = ${foreign.messageIds[0]}
        WHERE id = ${ownedDocument}
      `,
    );
    await expect(
      hydrateAs(ownerA, owned.chatId, ownedDocument),
    ).resolves.toBeNull();
    await expect(
      hydrateAs(ownerB, owned.chatId, ownedDocument),
    ).resolves.toBeNull();

    const ordered = await seedChat(ownerA, [
      { role: 'user', parts: [textPart('first source')] },
      { role: 'user', parts: [textPart('last source')] },
    ]);
    await indexService.reindexChat(ordered.chatId, ownerA);
    const orderedDocument = await firstDocumentId(ownerA, ordered.chatId);
    await updateDocument(
      ownerA,
      orderedDocument,
      sql`
        UPDATE search_chat_documents
        SET first_message_id = ${ordered.messageIds[1]},
            last_message_id = ${ordered.messageIds[0]}
        WHERE id = ${orderedDocument}
      `,
    );
    await expect(
      hydrateAs(ownerA, ordered.chatId, orderedDocument),
    ).resolves.toBeNull();
  });
});
