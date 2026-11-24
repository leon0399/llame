import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { CHUNKER_VERSION } from '../search/chat/conversation-chunker';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { ChatCreationRecordRepository } from '../chats/chat-creation-record.repository';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from '../projects/projects-repository';
import { runBackfill } from '../search/operations/backfill';
import { getProjectionCoverageReport } from '../search/operations/projection-coverage';
import { pruneUndeclaredModelVectors } from '../search/operations/prune';
import { isFunctionOwnedByBypassRlsRole } from '../search/discovery-provisioning';
import { SearchIndexService } from '../search/search-index.service';
import {
  countEligiblePerOwnedChat,
  findEarliestUserMessagePerChat,
  findLatestAssistantPerOwnedChat,
} from '../chats/recency-digest-message-projections';
import { createRecencyDigestItem } from '../chats/recency-digest-item';

const text = (value: string) => [{ type: 'text', text: value }];

describe('database data-query PostgreSQL regressions', () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: Db;
  let tenantDb: TenantDbService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    )
      .withUsername('app')
      .start();
    const adminUrl = container.getConnectionUri();
    const admin = postgres(adminUrl, { max: 5 });
    await admin.unsafe(
      'CREATE ROLE app_rls WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE',
    );
    await admin.unsafe('CREATE DATABASE llame_data_query_test');
    await admin.end();

    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = '/llame_data_query_test';
    vi.stubEnv('POSTGRES_URL', databaseUrl.href);

    try {
      const { runMigrate } = await import('./migrate.js');
      await runMigrate();
    } finally {
      vi.unstubAllEnvs();
    }

    client = postgres(databaseUrl.href, { max: 5 });
    db = drizzle({ client });
    tenantDb = new TenantDbService(db);
  }, 300_000);

  beforeEach(async () => {
    await client`DELETE FROM users`;
    await client`DELETE FROM embedding_model_bindings`;
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    try {
      await client?.end();
    } finally {
      await container?.stop();
    }
  });

  async function seedUser(): Promise<string> {
    const owner = crypto.randomUUID();
    await client`INSERT INTO users (id, name, email)
      VALUES (${owner}, 'Query test owner', ${`${owner}@test.invalid`})`;

    return owner;
  }

  async function seedChat(ownerUserId: string, title: string): Promise<string> {
    return tenantDb.runAs(ownerUserId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({ ownerUserId, title });
      await new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: ownerUserId,
        parts: text(`message for ${title}`),
      });

      return chat.id;
    });
  }

  async function stampModel(
    ownerUserId: string,
    chatId: string,
    modelKey: string,
  ): Promise<void> {
    await tenantDb.runAs(ownerUserId, async (tx) => {
      const [document] = await tx
        .select({ contentHash: schema.searchChatDocuments.contentHash })
        .from(schema.searchChatDocuments)
        .where(sql`${schema.searchChatDocuments.chatId} = ${chatId}`);

      if (!document) throw new Error(`Missing indexed document for ${chatId}`);
      await tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[0.1,0.2,0.3]'::vector,
            embedding_model_key = ${modelKey},
            embedded_content_hash = ${document.contentHash},
            embed_input_version = 1,
            embedding_fail_reason = NULL
        WHERE chat_id = ${chatId}
      `);
    });
  }

  async function insertBinding(modelKey: string): Promise<void> {
    await client`INSERT INTO embedding_model_bindings
      (model_key, provider_id, provider_model_id, dimensions)
      VALUES (${modelKey}, 'openai', 'text-embedding-3-small', 3)`;
  }

  it('appends creation attempts in order and returns the newest recorded directory', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'creation record');

    const first = {
      path: '/workspace/first',
      decision: {
        policyId: 'policy-first',
        decision: 'allow',
        reason: 'matched_allow',
        reference: { groupId: 'workspace', list: 'allow', clauseIndex: 0 },
      },
    } as const;

    const second = {
      path: '/workspace/second',
      decision: {
        policyId: 'policy-second',
        decision: 'allow',
        reason: 'matched_allow',
        reference: { groupId: 'workspace', list: 'allow', clauseIndex: 1 },
      },
    } as const;

    await tenantDb.runAs(owner, async (tx) => {
      const records = new ChatCreationRecordRepository(tx);
      await records.appendAttempt({
        ownerUserId: owner,
        chatId,
        decisions: [first],
        worktreeDirectory: '/worktrees/first',
      });
      await records.appendAttempt({
        ownerUserId: owner,
        chatId,
        decisions: [second],
        worktreeDirectory: '/worktrees/second',
      });

      const attempts = await records.findAttempts(owner, chatId);
      expect(attempts).toHaveLength(2);
      expect(attempts.map(({ decisions }) => decisions)).toEqual([
        [first],
        [second],
      ]);
      expect(
        attempts.map(({ worktreeDirectory }) => worktreeDirectory),
      ).toEqual(['/worktrees/first', '/worktrees/second']);
      expect(await records.findRecordedWorktreeDirectory(owner, chatId)).toBe(
        '/worktrees/second',
      );
    });
  });

  it('excludes pinned projects while keeping an unpinned project', async () => {
    const owner = await seedUser();

    const [pinned, unpinned] = await tenantDb.runAs(owner, async (tx) => {
      const projects = new ProjectsRepository(tx);

      const pinnedProject = await projects.create({
        ownerUserId: owner,
        name: 'Pinned',
      });

      const unpinnedProject = await projects.create({
        ownerUserId: owner,
        name: 'Unpinned',
      });

      await tx.insert(schema.pins).values({
        userId: owner,
        itemType: 'project',
        itemId: pinnedProject.id,
        position: 0,
      });

      return [pinnedProject, unpinnedProject];
    });

    const results = await tenantDb.runAs(owner, (tx) =>
      new ProjectsRepository(tx).listForUser(owner, { pinned: 'exclude' }),
    );

    expect(results.map(({ id }) => id)).toContain(unpinned.id);
    expect(results.map(({ id }) => id)).not.toContain(pinned.id);
  });

  it('reports a real projection and backfills its indexed chat under the real owner', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'projection coverage');
    await new SearchIndexService(tenantDb).reindexChat(chatId, owner);

    await expect(
      getProjectionCoverageReport(tenantDb, CHUNKER_VERSION),
    ).resolves.toMatchObject({
      chunkerVersion: CHUNKER_VERSION,
      chatCount: 1,
      readyChatCount: 1,
      staleChatCount: 0,
      documentCount: 1,
      completeDocumentCount: 1,
    });

    const enqueueChatEmbedStrict = vi.fn().mockResolvedValue('job-id');
    await expect(
      runBackfill(tenantDb, { enqueueChatEmbedStrict }, 'query-test-model', 1),
    ).resolves.toMatchObject({ enqueued: 1, coalesced: 0, failures: [] });
    expect(enqueueChatEmbedStrict).toHaveBeenCalledTimes(1);
    expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(chatId, owner);
  });

  it('reports the actual BYPASSRLS state of a function owner', async () => {
    await client`alter function llame_search_projection_coverage_v2(integer) owner to app_rls`;

    try {
      await expect(
        isFunctionOwnedByBypassRlsRole(
          tenantDb,
          'llame_search_projection_coverage_v2',
        ),
      ).resolves.toBe(true);
      await client`alter role app_rls nobypassrls`;
      await expect(
        isFunctionOwnedByBypassRlsRole(
          tenantDb,
          'llame_search_projection_coverage_v2',
        ),
      ).resolves.toBe(false);
    } finally {
      await client`alter role app_rls bypassrls`;
      await client`alter function llame_search_projection_coverage_v2(integer) owner to app`;
    }
  });

  it('prunes undeclared embedding metadata and retires bindings, including an empty declaration', async () => {
    const owner = await seedUser();
    const declaredChat = await seedChat(owner, 'declared model');
    const undeclaredChat = await seedChat(owner, 'undeclared model');
    const index = new SearchIndexService(tenantDb);
    await Promise.all([
      index.reindexChat(declaredChat, owner),
      index.reindexChat(undeclaredChat, owner),
    ]);

    const declaredKey = `declared-${crypto.randomUUID()}`;
    const undeclaredKey = `undeclared-${crypto.randomUUID()}`;
    await Promise.all([
      stampModel(owner, declaredChat, declaredKey),
      stampModel(owner, undeclaredChat, undeclaredKey),
      insertBinding(declaredKey),
      insertBinding(undeclaredKey),
    ]);

    const partial = await pruneUndeclaredModelVectors(tenantDb, [declaredKey]);
    expect(partial.failures).toEqual([]);
    expect(partial.retiredBindings).toBe(1);

    const rows = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({
          chatId: schema.searchChatDocuments.chatId,
          embedding: schema.searchChatDocuments.embedding,
          modelKey: schema.searchChatDocuments.embeddingModelKey,
          embeddedContentHash: schema.searchChatDocuments.embeddedContentHash,
          inputVersion: schema.searchChatDocuments.embedInputVersion,
          failureReason: schema.searchChatDocuments.embeddingFailReason,
        })
        .from(schema.searchChatDocuments),
    );

    expect(rows.find(({ chatId }) => chatId === declaredChat)).toMatchObject({
      embedding: '[0.1,0.2,0.3]',
      modelKey: declaredKey,
      inputVersion: 1,
      failureReason: null,
    });
    expect(rows.find(({ chatId }) => chatId === undeclaredChat)).toMatchObject({
      embedding: null,
      modelKey: null,
      embeddedContentHash: null,
      inputVersion: null,
      failureReason: null,
    });

    const all = await pruneUndeclaredModelVectors(tenantDb, []);
    expect(all.failures).toEqual([]);
    expect(all.retiredBindings).toBe(1);

    const remaining = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({
          chatId: schema.searchChatDocuments.chatId,
          modelKey: schema.searchChatDocuments.embeddingModelKey,
        })
        .from(schema.searchChatDocuments),
    );

    expect(
      remaining.find(({ chatId }) => chatId === declaredChat)?.modelKey,
    ).toBeNull();
  });

  it('keeps bindings when one real owner clear fails', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'failed owner prune');
    await new SearchIndexService(tenantDb).reindexChat(chatId, owner);
    const modelKey = `failed-owner-${crypto.randomUUID()}`;
    await stampModel(owner, chatId, modelKey);
    await insertBinding(modelKey);

    vi.spyOn(tenantDb, 'runAs').mockRejectedValueOnce(
      new Error('owner write failed'),
    );
    const result = await pruneUndeclaredModelVectors(tenantDb, []);
    expect(result.retiredBindings).toBe(0);
    expect(result.failures).toEqual([
      { ownerId: owner, message: 'owner write failed' },
    ]);

    const [binding] =
      await client`SELECT model_key FROM embedding_model_bindings WHERE model_key = ${modelKey}`;

    expect(binding?.model_key).toBe(modelKey);

    const [document] = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({ modelKey: schema.searchChatDocuments.embeddingModelKey })
        .from(schema.searchChatDocuments)
        .where(sql`${schema.searchChatDocuments.chatId} = ${chatId}`),
    );

    expect(document?.modelKey).toBe(modelKey);
  });

  it('selects immutable digest excerpt sources and counts only the requested owner Chats', async () => {
    const owner = await seedUser();
    const foreignOwner = await seedUser();

    const chatId = await tenantDb.runAs(
      owner,
      async (tx) =>
        (
          await new ChatsRepository(tx).create({
            ownerUserId: owner,
            title: 'included',
          })
        ).id,
    );

    const excludedChatId = await seedChat(owner, 'excluded');
    const foreignChatId = await seedChat(foreignOwner, 'foreign');

    const latest = await tenantDb.runAs(owner, async (tx) => {
      const repository = new MessagesRepository(tx);
      await repository.create({
        chatId,
        role: 'user',
        senderUserId: null,
        parts: [
          createRecencyDigestItem({
            runId: crypto.randomUUID(),
            payload: {
              version: 1,
              kind: 'baseline',
              announced: [],
              association: { kind: 'origin', chatId },
            },
            body: 'private digest',
          }),
        ],
      });
      await repository.create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: text('opening owner message'),
      });
      await repository.create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: text('later owner message'),
      });

      const completed = await repository.create({
        chatId,
        role: 'assistant',
        parts: text('immutable assistant excerpt'),
        usage: { status: 'completed' },
      });

      for (const status of ['running', 'failed']) {
        await repository.create({
          chatId,
          role: 'assistant',
          parts: text(`nonimmutable ${status}`),
          usage: { status },
        });
      }

      const revised = await repository.create({
        chatId,
        role: 'assistant',
        parts: text('superseded reply'),
      });

      await tx.execute(
        sql`update messages set revised_at = now() where id = ${revised.id}::uuid`,
      );
      await repository.create({
        chatId,
        role: 'assistant',
        parts: text(''),
      });

      return completed;
    });

    await tenantDb.runAs(foreignOwner, (tx) =>
      new MessagesRepository(tx).create({
        chatId: foreignChatId,
        role: 'assistant',
        parts: text('foreign reply'),
      }),
    );
    await tenantDb.runAs(owner, (tx) =>
      new MessagesRepository(tx).create({
        chatId: excludedChatId,
        role: 'assistant',
        parts: text('unrequested reply'),
      }),
    );

    await tenantDb.runAs(owner, async (tx) => {
      const ids = [chatId, foreignChatId];
      expect(
        (await findLatestAssistantPerOwnedChat(tx, ids, owner)).map(
          ({ id }) => id,
        ),
      ).toEqual([latest.id]);
      expect(
        (await findEarliestUserMessagePerChat(tx, ids, owner)).map(
          ({ chatId: sourceChatId, parts }) => ({
            chatId: sourceChatId,
            parts,
          }),
        ),
      ).toEqual([{ chatId, parts: text('opening owner message') }]);
      expect(await countEligiblePerOwnedChat(tx, ids, owner)).toEqual(
        new Map([[chatId, 4]]),
      );
    });
  });

  it('keeps late digest carriers out of public history and latest-turn guards', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'public source');

    await tenantDb.runAs(owner, async (tx) => {
      const repository = new MessagesRepository(tx);
      const original = (await repository.findByChatId(chatId, owner))[0];

      if (!original) throw new Error('Missing original owner message');

      const carrier = await repository.create({
        chatId,
        role: 'user',
        senderUserId: null,
        parts: [
          createRecencyDigestItem({
            runId: crypto.randomUUID(),
            payload: {
              version: 1,
              kind: 'baseline',
              announced: [],
              association: { kind: 'origin', chatId },
            },
            body: 'private digest',
          }),
        ],
      });

      await tx.execute(
        sql`update chats set visibility = 'public' where id = ${chatId}::uuid`,
      );

      expect(
        await repository.hasLaterUserMessage(chatId, owner, original.seq),
      ).toBe(false);
      expect(
        (await repository.listPublicByChatId(chatId)).map(({ id }) => id),
      ).toEqual([original.id]);

      const later = await repository.create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: text('actual later turn'),
      });

      expect(
        await repository.hasLaterUserMessage(chatId, owner, original.seq),
      ).toBe(true);
      expect(
        (await repository.listPublicByChatId(chatId)).map(({ id }) => id),
      ).toEqual([original.id, later.id]);
      expect(
        (await repository.findByChatId(chatId, owner)).map(({ id }) => id),
      ).toEqual([original.id, carrier.id, later.id]);
    });
  });

  it('includes associated carriers above the replay and fork storage boundary', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'replay source');

    await tenantDb.runAs(owner, async (tx) => {
      const repository = new MessagesRepository(tx);
      const original = (await repository.findByChatId(chatId, owner))[0];

      if (!original) throw new Error('Missing original owner message');

      const trigger = await repository.create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: text('trigger'),
      });

      const baseline = await repository.create({
        chatId,
        role: 'user',
        senderUserId: null,
        parts: [
          createRecencyDigestItem({
            runId: crypto.randomUUID(),
            payload: {
              version: 1,
              kind: 'baseline',
              announced: [],
              association: { kind: 'origin', chatId },
            },
            body: 'frozen baseline',
          }),
        ],
      });

      await repository.create({
        chatId,
        role: 'assistant',
        parts: text('reply beyond trigger'),
      });

      expect(
        (
          await repository.findEffectiveContextMessages(chatId, owner, {
            throughSeq: trigger.seq,
          })
        ).map(({ id }) => id),
      ).toEqual([baseline.id, original.id]);
      expect(
        (await repository.findForkSource(chatId, owner, original.seq)).map(
          ({ id }) => id,
        ),
      ).toEqual([original.id, baseline.id]);
    });
  });
});
