/**
 * Integration: per-user context is rendered and BOUND per run.
 *
 * The unit tests prove the projection and the render; these prove the wiring —
 * that two owners on one model bind their own values and never each other's,
 * and that a profile edit cannot reach a run already enqueued.
 *
 * Set TEST_DATABASE_URL to run (the test:integration globalSetup provisions it).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type ModelSelectionValidator } from '../models/models.service';
import { ChatLoopService } from '../chats/chat-loop.service';
import { MessagesRepository } from '../chats/chats-repository';
import { isTextPart } from '../chats/context-builder';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { RunsRepository } from '../runs/runs-repository';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { PersonalizationService } from './personalization.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { createFakeModelClient } from '../models/fake-model-client';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { CompactionCapability } from '../compaction/compaction.service';
import type { TitleCapability } from '../titles/title.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from '../chats/recency-digest.service';

import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { SearchIndexService } from '../search/search-index.service';
import type { KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import type { KnowledgeToolResolver } from '../tools/types';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const knowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    resolveHostPath: () =>
      Promise.reject(new Error('Knowledge adapter is not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () => Promise.resolve([]),
};
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('personalization binds per run', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let chatLoop: ChatLoopService;
  let runExecution: RunExecutionService;
  let personalization: PersonalizationService;
  let userAId: string;
  let userBId: string;

  /** Execute the accepted queued run through worker-owned context preparation. */
  const execute = async (userId: string, chatId: string, messageId: string) => {
    const { run, message } = await tenantDb.runAs(userId, async (tx) => {
      const [run] = await new RunsRepository(tx).findByChatId(chatId, userId);
      const message = await new MessagesRepository(tx).findById(
        chatId,
        userId,
        messageId,
      );
      return { run, message };
    });
    if (!run || !message) throw new Error('Failed to load accepted run');
    const result = await runExecution.executeRun({
      runId: run.id,
      chatId,
      userId,
      userMessage: {
        id: message.id,
        seq: message.seq,
        parts: message.parts.filter(isTextPart),
      },
      client: createFakeModelClient(['done']),
    });
    await result.consumeStream?.();
  };
  // test exercises the actual renderer (including its trim-means-absent rule)
  // rather than a stub that has to re-implement it and can drift from it.
  const SYSTEM_PROMPT_TEMPLATE =
    'Base prompt.' +
    '{{#if user.personalization.preferredName}} Name: {{user.personalization.preferredName}}{{/if}}' +
    '{{#if user.personalization.about}} About: {{user.personalization.about}}{{/if}}' +
    '{{#if user.email}} Email: {{user.email}}{{/if}}';

  const send = (userId: string, chatId: string, messageId: string) =>
    chatLoop.createMessageStream({
      chatId,
      userId,
      modelId: 'system:openai:gpt-5.4-mini',
      message: { id: messageId, parts: [{ type: 'text', text: 'hello' }] },
    });

  /** The system prompt actually recorded for that chat's winning attempt. */
  const boundReceipt = async (userId: string, chatId: string) =>
    tenantDb.runAs(userId, async (tx) => {
      const [run] = await new RunsRepository(tx).findByChatId(chatId, userId);
      if (!run?.completedAttemptId) {
        throw new Error('Expected a completed attempt receipt');
      }
      const receipt = await new SystemPromptReceiptsRepository(
        tx,
      ).findByAttempt(run.id, run.completedAttemptId, userId);
      if (!receipt) {
        throw new Error('Expected a system prompt receipt');
      }
      return receipt;
    });

  const boundPrompt = async (userId: string, chatId: string) =>
    (await boundReceipt(userId, chatId)).systemPrompt;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    personalization = new PersonalizationService(tenantDb);

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Bind A', ${`bind-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Bind B', ${`bind-b-${userBId}@test.com`})`;

    const models: ModelSelectionValidator = {
      validateModelSelection: (modelId: string) => ({
        id: modelId,
        source: 'system' as const,
        contextWindowTokens: 128_000,
        provider: 'openai',
        providerModelId: modelId,
        systemPromptTemplate: SYSTEM_PROMPT_TEMPLATE,
        systemPromptSource: 'project_default' as const,
        referencesSkills: false,
      }),
      // No reasoning vocabulary on this double: effort always resolves to
      // "none".
      resolveEffortSelection: () => undefined,
    };

    chatLoop = new ChatLoopService(
      tenantDb,
      models,
      { config: BUILT_IN_DEFAULTS },
      { createUiMessageStreamResponse: () => new Response(null) },
      new RunAbortRegistry(),
      { dispatch: () => Promise.resolve() },
    );
    runExecution = new RunExecutionService(
      tenantDb,
      {
        maybeCompact: async () => {},
        compactForTransition: () => Promise.resolve('created' as const),
      } satisfies CompactionCapability,
      { maybeGenerateTitle: async () => {} } satisfies TitleCapability,
      { config: BUILT_IN_DEFAULTS } satisfies InstanceConfigReader,
      new SearchIndexService(tenantDb),
      noopReindexDispatch(),
      knowledgeResolver,
      noopSkillCatalog(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      compileTestPermissionPolicy(),
      models,
      new SystemPromptsService(),
      personalization,
      knowledgeCandidates,
      { snapshotCandidates: () => [] },
      new MemoryService(tenantDb),
      new RecencyDigestService(tenantDb),
      undefined,
    );
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('binds each owner their own values and neither the other owner’s', async () => {
    await personalization.updateForOwner(userAId, {
      preferredName: 'Ana',
      about: 'A private about text',
    });
    await personalization.updateForOwner(userBId, {
      preferredName: 'Bee',
      about: 'B private about text',
    });

    const chatA = crypto.randomUUID();
    const chatB = crypto.randomUUID();
    const messageA = crypto.randomUUID();
    const messageB = crypto.randomUUID();
    await send(userAId, chatA, messageA);
    await send(userBId, chatB, messageB);
    await execute(userAId, chatA, messageA);
    await execute(userBId, chatB, messageB);
    const promptA = await boundPrompt(userAId, chatA);
    const promptB = await boundPrompt(userBId, chatB);

    expect(promptA).toContain('Name: Ana');
    expect(promptA).toContain('A private about text');
    expect(promptA).not.toContain('Bee');
    expect(promptA).not.toContain('B private about text');

    expect(promptB).toContain('Name: Bee');
    expect(promptB).not.toContain('Ana');
    expect(promptB).not.toContain('A private about text');
  });

  it('an edit after enqueue is observed when the worker prepares the attempt', async () => {
    await personalization.updateForOwner(userAId, { preferredName: 'Before' });

    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await send(userAId, chatId, messageId);

    // The owner edits after enqueue but before worker execution.
    await personalization.updateForOwner(userAId, { preferredName: 'After' });
    await execute(userAId, chatId, messageId);

    const bound = await boundPrompt(userAId, chatId);
    expect(bound).toContain('Name: After');
    expect(bound).not.toContain('Name: Before');

    // The NEXT run also picks the current value up.
    const nextChat = crypto.randomUUID();
    const nextMessage = crypto.randomUUID();
    await send(userAId, nextChat, nextMessage);
    await execute(userAId, nextChat, nextMessage);
    expect(await boundPrompt(userAId, nextChat)).toContain('Name: After');
  });

  it('withholds account identity until the owner opts in, then binds it', async () => {
    await personalization.updateForOwner(userAId, {
      preferredName: 'Ana',
      shareAccountIdentity: false,
    });
    const withheldChat = crypto.randomUUID();
    const withheldMessage = crypto.randomUUID();
    await send(userAId, withheldChat, withheldMessage);
    await execute(userAId, withheldChat, withheldMessage);
    expect(await boundPrompt(userAId, withheldChat)).not.toContain('Email:');

    await personalization.updateForOwner(userAId, {
      shareAccountIdentity: true,
    });
    const sharedChat = crypto.randomUUID();
    const sharedMessage = crypto.randomUUID();
    await send(userAId, sharedChat, sharedMessage);
    await execute(userAId, sharedChat, sharedMessage);
    expect(await boundPrompt(userAId, sharedChat)).toContain(
      `Email: bind-a-${userAId}@test.com`,
    );
  });

  it('disabling personalization stops everything, including identity', async () => {
    await personalization.updateForOwner(userAId, {
      enabled: false,
      shareAccountIdentity: true,
    });

    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await send(userAId, chatId, messageId);
    await execute(userAId, chatId, messageId);
    const bound = await boundPrompt(userAId, chatId);

    expect(bound).toBe('Base prompt.');
    expect(bound).not.toContain('Ana');
    expect(bound).not.toContain('Email:');

    await personalization.updateForOwner(userAId, { enabled: true });
  });
});
