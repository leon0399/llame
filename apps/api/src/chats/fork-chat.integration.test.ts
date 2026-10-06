import { NotFoundException } from '@nestjs/common';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { type Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { createCompactionCheckpointPart } from './context-item-producers';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatsService } from './chats.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

/**
 * Owner and shared fork integration coverage for checkpoint rows. The source
 * is seeded through the production message/checkpoint repositories so this
 * suite verifies the persisted row shape, dense destination sequences, and
 * public projection rather than a test-only copy path.
 */
describeIfDb('forkChat — checkpoint rows + RLS', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let ownerId: string;
  let visitorId: string;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    service = new ChatsService(
      tenantDb,
      new RunAbortRegistry(),
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
    );
    ownerId = crypto.randomUUID();
    visitorId = crypto.randomUUID();
    await sql`
      INSERT INTO users (id, name, email)
      VALUES
        (${ownerId}, 'Fork owner', ${`fork-owner-${ownerId}@test.invalid`}),
        (${visitorId}, 'Fork visitor', ${`fork-visitor-${visitorId}@test.invalid`})
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${visitorId})`;
      await sql.end();
    }
  });

  async function seedSource(visibility: 'private' | 'public') {
    return tenantDb.runAs(ownerId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const source = await chats.create({
        ownerUserId: ownerId,
        title: 'Checkpoint source',
        visibility,
      });
      const firstUser = await messages.create({
        chatId: source.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [{ type: 'text', text: 'question one' }],
      });
      const firstAssistant = await messages.create({
        chatId: source.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'answer one' }],
        inReplyTo: firstUser.id,
        usage: { status: 'completed', totalTokens: 10 },
      });
      const secondUser = await messages.create({
        chatId: source.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [{ type: 'text', text: 'question two' }],
      });
      const secondAssistant = await messages.create({
        chatId: source.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'answer two' }],
        inReplyTo: secondUser.id,
        usage: { status: 'completed', totalTokens: 12 },
      });

      // A presentation row between the absorbed prefix and the checkpoint
      // makes the fork prove that absorbedThroughSeq, not source checkpoint
      // seq, is remapped to the copied dense sequence.
      await messages.create({
        chatId: source.id,
        role: 'system',
        senderUserId: null,
        parts: [{ type: 'text', text: 'internal presentation row' }],
      });
      const checkpoint = await messages.createCheckpoint({
        chatId: source.id,
        absorbedThroughSeq: secondAssistant.seq,
        part: createCompactionCheckpointPart('summary before question three'),
        usage: { model: 'test-model', inputTokens: 20, outputTokens: 8 },
      });
      const thirdUser = await messages.create({
        chatId: source.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [{ type: 'text', text: 'question three' }],
      });

      return {
        source,
        rows: [
          firstUser,
          firstAssistant,
          secondUser,
          secondAssistant,
          checkpoint,
          thirdUser,
        ],
        checkpoint,
      };
    });
  }

  async function readMessages(
    chatId: string,
    userId: string,
  ): Promise<Array<Message>> {
    return tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
  }

  it('copies a checkpoint with the same absorbed rows and remaps its dense boundary', async () => {
    const seeded = await seedSource('private');

    const forked = await service.forkChat(seeded.source.id, ownerId);
    const copied = await readMessages(forked.id, ownerId);
    const copiedCheckpoint = copied.find(
      (message) => message.role === 'checkpoint',
    );

    if (!copiedCheckpoint) {
      throw new Error('expected owner fork checkpoint');
    }
    expect(copied.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'checkpoint',
      'user',
    ]);
    expect(copied.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(copiedCheckpoint.absorbedThroughSeq).toBe(4);
    expect(copiedCheckpoint.parts).toEqual(seeded.checkpoint.parts);
    expect(copiedCheckpoint.usage).toEqual(seeded.checkpoint.usage);

    const ownerHistory = await service.getChatMessages(forked.id, ownerId, {
      limit: 50,
    });
    const copiedCheckpointDto = ownerHistory?.messages.find(
      (message) => message.role === 'checkpoint',
    );
    expect(copiedCheckpointDto?.absorbedMessageCount).toBe(4);
  });

  it('does not copy a checkpoint whose absorbed boundary is after the anchor', async () => {
    const seeded = await seedSource('private');
    const anchor = seeded.rows[2];

    const forked = await service.forkChat(seeded.source.id, ownerId, anchor.id);
    const copied = await readMessages(forked.id, ownerId);

    expect(copied.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(copied.some((message) => message.role === 'checkpoint')).toBe(false);
  });

  it('shared fork of a public compacted chat remains text-only', async () => {
    const seeded = await seedSource('public');
    const forked = await service.forkSharedChat(seeded.source.id, visitorId);

    if (!forked) {
      throw new Error('expected shared fork');
    }
    const copied = await readMessages(forked.id, visitorId);
    expect(copied.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(copied.some((message) => message.role === 'checkpoint')).toBe(false);
    expect(JSON.stringify(copied)).not.toContain(
      'summary before question three',
    );
  });

  it('keeps owner forks tenant-scoped', async () => {
    const seeded = await seedSource('private');

    await expect(service.forkChat(seeded.source.id, visitorId)).rejects.toThrow(
      NotFoundException,
    );
    const foreignRead = await tenantDb.runAs(visitorId, (tx) =>
      new MessagesRepository(tx).findByChatId(seeded.source.id, visitorId),
    );
    expect(foreignRead).toEqual([]);
  });

  it('does not expose a checkpoint through the anonymous public read policy', async () => {
    const seeded = await seedSource('public');

    const publicRows = await tenantDb.runAsPublic((tx) =>
      tx
        .select({ role: schema.messages.role })
        .from(schema.messages)
        .where(dsql`${schema.messages.chatId} = ${seeded.source.id}`),
    );
    expect(publicRows.map(({ role }) => role)).not.toContain('checkpoint');
  });
});
