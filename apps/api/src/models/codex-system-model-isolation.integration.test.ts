/**
 * Codex system-model tenancy acceptance (codex-subscription-provider task 2.8).
 *
 * The configured Codex model is visible to every authenticated owner through the
 * instance catalog. Its subscription must never widen the owner scope carried
 * into Chats, Runs, or a conversation-reading tool.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { seedModelContextSnapshot } from '../runs/model-context-snapshot.test-fixture';
import { RunsRepository } from '../runs/runs-repository';
import { searchConversationsTool } from '../tools/search-conversations';
import { ModelsService } from './models.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

const CODEX_MODEL_ID = 'system:codex:gpt-test';

function configuredCodexModels(): ModelsService {
  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      defaults: {
        modelId: CODEX_MODEL_ID,
        titleGenerationModelId: null,
      },
      providers: [
        {
          id: 'personal-codex',
          type: 'openai-codex',
          key: 'integration-access-token',
          accountId: 'integration-account-id',
        },
      ],
      models: [
        {
          id: CODEX_MODEL_ID,
          source: 'system',
          provider: 'personal-codex',
          providerModelId: 'gpt-test',
          name: 'Configured Codex model',
          contextWindowTokens: 128_000,
          systemPromptTemplate: 'Use only authorized tools.',
          systemPromptSource: 'project_default',
        },
      ],
    },
  };
  return new ModelsService(instanceConfig);
}

describeIfDb('Codex system-model owner isolation', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let firstOwnerId: string;
  let secondOwnerId: string;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);

    firstOwnerId = crypto.randomUUID();
    secondOwnerId = crypto.randomUUID();
    for (const [id, name] of [
      [firstOwnerId, 'Codex first owner'],
      [secondOwnerId, 'Codex second owner'],
    ] as const) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, ${name}, ${`${id}@test.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${firstOwnerId}, ${secondOwnerId})`;
      await sql.end();
    }
  });

  it('shares the system catalog without sharing Chats, Runs, or conversation search data', async () => {
    const models = configuredCodexModels();
    const catalog = models.getAvailableModels();
    expect(catalog.defaultModelId).toBe(CODEX_MODEL_ID);
    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: CODEX_MODEL_ID,
        name: 'Configured Codex model',
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toContain('integration-access-token');
    expect(JSON.stringify(catalog)).not.toContain('integration-account-id');

    const chatId = crypto.randomUUID();
    const seeded = await tenantDb.runAs(firstOwnerId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: firstOwnerId,
        title: 'Codex isolation secret',
      });
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: firstOwnerId,
        parts: [{ type: 'text', text: 'Codex isolation secret' }],
      });
      const snapshot = await seedModelContextSnapshot(
        tx,
        firstOwnerId,
        'codex-isolation',
      );
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId: firstOwnerId,
        modelId: CODEX_MODEL_ID,
        modelContextSnapshotId: snapshot.id,
      });
      return { run };
    });

    await tenantDb.runAs(secondOwnerId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const runs = new RunsRepository(tx);
      expect(await chats.findById(chatId, secondOwnerId)).toBeUndefined();
      expect(
        await chats.update(chatId, secondOwnerId, {
          title: 'cross-owner mutation',
        }),
      ).toBeUndefined();
      expect(await runs.findById(seeded.run.id, secondOwnerId)).toBeUndefined();
      expect(
        await runs.requestCancel(seeded.run.id, secondOwnerId),
      ).toBeUndefined();
    });

    const search = await searchConversationsTool.execute(
      {
        userId: secondOwnerId,
        chatId: crypto.randomUUID(),
        tenantDb,
      },
      { mode: 'content', query: 'Codex isolation secret' },
    );
    expect(search).toMatchObject({ status: 'success', results: [] });

    await tenantDb.runAs(firstOwnerId, async (tx) => {
      expect(
        await new ChatsRepository(tx).findById(chatId, firstOwnerId),
      ).toMatchObject({
        title: 'Codex isolation secret',
      });
      expect(
        await new RunsRepository(tx).findById(seeded.run.id, firstOwnerId),
      ).toBeDefined();
    });
  });
});
