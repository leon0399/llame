/**
 * ChatLoopService single-flight regression (durable-run-workers, task 7.8) —
 * light-integration: a REAL Postgres + TenantDbService/repositories exercise
 * the actual `runs_chat_inflight_unique` partial index and its
 * catch/re-check/retry logic in persistUserMessageAndRun, with only the
 * execution-adjacent leaves mocked (ModelsService.validateModelSelection,
 * RunStreamBridgeService, RunDispatchService.dispatch) — the same
 * direct-instantiation-of-repos pattern as active-runs.integration.test.ts.
 *
 * `chat-loop.service.test.ts` already unit-tests the model-selection guard
 * against a fully mocked `tenantDb.runAs`; that mock cannot exercise a real
 * unique-constraint race, which is exactly what these tests guard: the D7
 * unwedge deletion (chat-loop.service.ts) narrowed single-flight enqueue to
 * "409 + vanished-blocker retry" with NO enqueue-side expiry — these three
 * scenarios are the ones that regression would silently break.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { streamText } from 'ai';
import { expectMessageParts } from '../testing/support';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { ConflictException } from '@nestjs/common';

import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  type Compaction,
  type ModelToolDeclaration,
  type Run,
  type TurnToolAvailabilityEntry,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type ModelSelectionValidator } from '../models/models.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { type RunJob } from '../runs/run-queues';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { type DynamicToolExecutorResolver } from '../runs/snapshot-tool-execution';
import { ChatLoopService } from './chat-loop.service';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from './recency-digest.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { createModelPromptLoader } from '../instance-config/prompt-loader';
import { type CompactionCapability } from '../compaction/compaction.service';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { type KnowledgeToolResolver } from '../tools/types';
import { TOOL_REGISTRY } from '../tools/registry';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import {
  canonicalJson,
  type ResolvedAttemptContext,
} from '../runs/effective-context-resolver';
import * as effectiveContextResolver from '../runs/effective-context-resolver';
import { hashWithDomain } from '../canonical-json';
import {
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';
import { renderConversationCheckpoint } from './context-builder';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

function compactionReplacementHistory(
  summary: string,
): Compaction['replacementHistory'] {
  return [
    {
      role: 'user',
      parts: [{ type: 'text', text: renderConversationCheckpoint(summary) }],
    },
  ];
}

const workerKnowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    resolveHostPath: () =>
      Promise.reject(new Error('Knowledge adapter is not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};

const workerKnowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

const workerDynamicToolResolver: DynamicToolExecutorResolver = {
  // Availability tests use synthetic dynamic declarations. Binding them to an
  // unavailable executor is enough to exercise preparation without executing
  // a real external tool.
  resolveDynamicTool: () => ({ state: 'unavailable' }),
};

function workerModelClient(modelId: string, fail = false): ModelClient {
  const chunks: Array<LanguageModelV3StreamPart> = fail
    ? [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: new Error('forced worker stream failure') },
      ]
    : [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'worker response' },
        { type: 'text-end', id: 'text' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ];
  const model = new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
  });
  return {
    model: modelId,
    provider: 'test',
    contextWindowTokens: 128_000,
    streamText(input: ModelStreamInput) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
          else if (chunk.type === 'reasoning-delta')
            input.onReasoningDelta?.(chunk.text);
        },
        onError: input.onError,
        onFinish: (event) =>
          input.onFinish?.({
            text: event.text,
            usage: event.usage,
            finishReason: event.finishReason,
          }),
      });
    },
  };
}

describeIfDb(
  'ChatLoopService — single-flight regression (design D3/D7)',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let userId: string;
    let dispatchCalls: Array<RunJob>;
    let chatLoop: ChatLoopService;
    let systemPrompt: string;
    let allowedTools: Array<string>;
    let runExecution: RunExecutionService;

    type AvailabilityState =
      | { id: string; state: 'available' }
      | {
          id: string;
          state: 'unavailable';
          reason: ToolUnavailableReason;
        };

    function availabilityContext(
      states: ReadonlyArray<AvailabilityState>,
    ): ResolvedAttemptContext {
      const prompt = 'Availability integration prompt';
      const toolDeclarations: Array<ModelToolDeclaration> = states.flatMap(
        (state) =>
          state.state === 'available'
            ? [
                {
                  id: state.id,
                  description: `Test declaration for ${state.id}`,
                  inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                  },
                },
              ]
            : [],
      );
      const toolAvailabilityManifest: ToolAvailabilityManifestV1 = {
        version: 1,
        entries: states.map((state) => {
          if (state.state === 'unavailable') return state;
          const declaration = toolDeclarations.find(
            ({ id }) => id === state.id,
          )!;
          return {
            id: state.id,
            state: 'available' as const,
            declarationHash: hashWithDomain(
              'llame:tool-declaration:v1',
              canonicalJson(declaration),
            ),
          };
        }),
      };
      return {
        promptHash: hashWithDomain('llame:model-context:prompt:v1', prompt),
        source: 'project_default',
        systemPrompt: prompt,
        toolAvailabilityManifest,
        toolDeclarations,
      };
    }
    type PersistResult = {
      runId: string;
      userMessage: RunJob['userMessage'];
      run: Run;
    };

    const executeWorker = async (
      job: RunJob,
      options: { consume?: boolean; fail?: boolean } = {},
    ): Promise<Run> => {
      const result = await runExecution.executeRun({
        runId: job.runId,
        chatId: job.chatId,
        userId: job.userId,
        userMessage: job.userMessage,
        client: workerModelClient(job.modelId, options.fail),
      });
      if (options.consume !== false) {
        await result.consumeStream?.();
      }
      const run = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(job.runId, userId),
      );
      if (!run) throw new Error(`Expected worker run ${job.runId}`);
      return run;
    };

    const persistWithContext = async (
      chatId: string,
      text: string,
      effectiveContext: ResolvedAttemptContext,
      modelId = 'system:openai:gpt-5.4-mini',
    ): Promise<PersistResult> => {
      // The API only persists the sanitized user message. Resolve the supplied
      // context through the actual worker preparation path, leaving terminal
      // status to each test so failed attempts cannot commit staged metadata.
      const resolve = vi
        .spyOn(effectiveContextResolver, 'resolveEffectiveContext')
        .mockResolvedValueOnce(effectiveContext);
      try {
        await chatLoop
          .createMessageStream({
            chatId,
            userId,
            modelId,
            message: {
              id: crypto.randomUUID(),
              parts: [{ type: 'text', text }],
            },
          })
          .then(() => undefined);
        const job = dispatchCalls.at(-1);
        if (!job) throw new Error('Expected accepted Run dispatch');
        const run = await executeWorker(job, { consume: false });
        return {
          runId: job.runId,
          userMessage: job.userMessage,
          run,
        };
      } finally {
        resolve.mockRestore();
      }
    };

    const availabilityRunItem = (run: Run) =>
      run.contextItems?.find(
        ({ producer }) => producer === 'tool-availability',
      );

    const finish = (
      runId: string,
      status: 'completed' | 'failed' | 'cancelled' | 'expired' = 'completed',
      turnToolAvailability?: Array<TurnToolAvailabilityEntry>,
    ) =>
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(
          runId,
          userId,
          status,
          turnToolAvailability === undefined
            ? undefined
            : { turnToolAvailability },
        ),
      );

    beforeAll(async () => {
      const postgres = await import('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 5 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      userId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Chat Loop Regression', ${`chat-loop-regression-${userId}@test.com`})`;
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        await sql.end();
      }
    });

    beforeEach(async () => {
      dispatchCalls = [];
      systemPrompt = 'Chat-loop integration prompt';
      allowedTools = [];
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: false,
      });
      const models: ModelSelectionValidator = {
        validateModelSelection: (modelId: string) => ({
          id: modelId,
          source: 'system',
          contextWindowTokens: 128_000,
          provider: 'openai',
          providerModelId: modelId,
          systemPromptTemplate: systemPrompt,
          systemPromptSource: 'project_default',
          referencesSkills: false,
        }),
        // No reasoning vocabulary on these doubles: effort always resolves
        // to "none".
        resolveEffortSelection: () => undefined,
      };
      const bridge: RunStreamResponder = {
        createUiMessageStreamResponse: vi
          .fn<RunStreamResponder['createUiMessageStreamResponse']>()
          .mockReturnValue(new Response()),
      };
      const aborts = new RunAbortRegistry();
      const dispatch: RunDispatcher = {
        dispatch: vi.fn<RunDispatcher['dispatch']>((job) => {
          dispatchCalls.push(job);
          return Promise.resolve();
        }),
      };

      const instanceConfig: InstanceConfigReader = {
        config: {
          ...BUILT_IN_DEFAULTS,
          runs: {
            ...BUILT_IN_DEFAULTS.runs,
            timeoutSeconds: 300,
            heartbeatSeconds: 15,
          },
          tools: {
            ...BUILT_IN_DEFAULTS.tools,
            allowed: allowedTools,
            callTimeoutSeconds: 15,
          },
        },
      };

      chatLoop = new ChatLoopService(
        tenantDb,
        models,
        instanceConfig,
        bridge,
        aborts,
        dispatch,
      );

      const noopCompaction: CompactionCapability = {
        maybeCompact: async () => {},
        compactForTransition: () => {
          throw new Error(
            'chat-loop integration compactForTransition is not exercised',
          );
        },
      };
      runExecution = new RunExecutionService(
        tenantDb,
        noopCompaction,
        { maybeGenerateTitle: async () => {} },
        instanceConfig,
        { reindexChat: async () => {} },
        noopReindexDispatch(),
        workerKnowledgeResolver,
        noopSkillCatalog(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
        compileTestPermissionPolicy(),
        models,
        new SystemPromptsService(),
        { resolvePromptUser: () => Promise.resolve(undefined) },
        workerKnowledgeCandidates,
        { snapshotCandidates: () => [] },
        new MemoryService(tenantDb),
        new RecencyDigestService(tenantDb),
        workerDynamicToolResolver,
      );
    });

    const send = (
      chatId: string,
      messageId: string,
      text: string,
      modelId = 'system:openai:gpt-5.4-mini',
    ) =>
      chatLoop.createMessageStream({
        chatId,
        userId,
        modelId,
        message: { id: messageId, parts: [{ type: 'text', text }] },
      });

    const activeRun = (chatId: string) =>
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findActiveByChatId(chatId, userId),
      );

    const seedEligibleChat = async (
      ownerUserId: string,
      title: string,
      text: string,
    ) =>
      tenantDb.runAs(ownerUserId, async (tx) => {
        const chat = await new ChatsRepository(tx).create({
          ownerUserId,
          title,
        });
        await new MessagesRepository(tx).create({
          chatId: chat.id,
          role: 'user',
          senderUserId: ownerUserId,
          parts: [{ type: 'text', text }],
        });
        return chat;
      });

    const finishActive = async (chatId: string) => {
      const run = await activeRun(chatId);
      if (!run) throw new Error('Expected an active run');
      const job = dispatchCalls.find(({ runId }) => runId === run.id);
      if (!job) throw new Error(`Expected dispatch for run ${run.id}`);
      return executeWorker(job);
    };

    // The excerpt SOURCE is chosen by `findEarliestUserMessagePerChat`, not by
    // the builder, so the capability's "no assistant or tool content" rule is
    // enforced in SQL and has to be proved against a real database. A unit
    // test over an in-memory list cannot see a DISTINCT ON partition or a role
    // predicate.
    it('excerpts the earliest USER message, never an assistant or later turn', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      const source = await tenantDb.runAs(userId, async (tx) => {
        const chat = await new ChatsRepository(tx).create({
          ownerUserId: userId,
          title: 'Mixed history source',
        });
        const messagesRepo = new MessagesRepository(tx);
        // Assistant speaks FIRST, so a naive "earliest message" would leak it.
        await messagesRepo.create({
          chatId: chat.id,
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'assistant-must-not-leak' }],
        });
        await messagesRepo.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: userId,
          parts: [
            { type: 'text', text: 'owner-opening' },
            { type: 'reasoning', text: 'reasoning-must-not-leak' },
          ],
        });
        await messagesRepo.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'later-user-must-not-leak' }],
        });
        return chat;
      });
      systemPrompt =
        'Base.{{#each chats.recent}} {{title}}|{{messageCount}}|{{excerpt}}{{/each}}';
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'target turn');
      await finishActive(chatId);
      const chat = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(chatId, userId),
      );

      const entry = chat?.recencyDigestBaseline?.recent.find(
        ({ title }) => title === 'Mixed history source',
      );
      expect(entry).toMatchObject({
        excerpt: 'owner-opening',
        // Counts every stored message, not just the excerpted one.
        messageCount: 3,
      });
      expect(JSON.stringify(chat?.recencyDigestBaseline)).not.toMatch(
        /assistant-must-not-leak|reasoning-must-not-leak|later-user-must-not-leak/,
      );
      expect(source.id).toBeDefined();
    });

    it('freezes one baseline and records a receipt on each later run', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await seedEligibleChat(userId, 'Baseline source', 'source opening');
      systemPrompt =
        'Base.{{#each chats.recent}} {{title}}|{{date}}|{{messageCount}}|{{excerpt}}{{/each}}';
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'first target turn');
      const firstRun = await finishActive(chatId);
      const firstChat = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(chatId, userId),
      );
      expect(firstChat?.recencyDigestBaseline?.recent[0]).toMatchObject({
        title: 'Baseline source',
        excerpt: 'source opening',
      });

      await seedEligibleChat(userId, 'Later source', 'must stay absent');
      await send(chatId, crypto.randomUUID(), 'second target turn');
      await finishActive(chatId);
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );

      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe(firstRun.id);
      const secondReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          runs[1].id,
          userId,
        ),
      );
      expect(secondReceipts[0]?.systemPrompt).not.toContain('Later source');
      expect(secondReceipts[0]?.systemPrompt).not.toContain('must stay absent');
    });

    it('renders the packaged digest into the receipt and retains a bound baseline after withdrawal', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await seedEligibleChat(userId, 'Receipt source', 'receipt opening');
      systemPrompt = createModelPromptLoader({
        configPath: path.resolve(__dirname, '../../llame.config.json'),
      }).resolve({
        id: 'system:openai:gpt-5.4-mini',
        name: 'Test Model',
      }).systemPromptTemplate;
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'first target turn');
      const firstRun = await finishActive(chatId);
      const firstReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          firstRun.id,
          userId,
        ),
      );
      const firstReceipt = firstReceipts[0];
      expect(firstReceipt?.systemPrompt).toContain('<user_chat_history>');
      expect(firstReceipt?.systemPrompt).toContain('Receipt source');
      expect(firstReceipt?.systemPrompt).toContain('receipt opening');
      expect(firstReceipt?.systemPrompt).not.toMatch(
        /\/home\/|providerModelId|systemPromptFile/u,
      );

      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: false,
      });
      await seedEligibleChat(userId, 'Withheld new source', 'must not append');
      await send(chatId, crypto.randomUUID(), 'withdrawn target turn');
      await finishActive(chatId);
      const [first, second] = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      const secondReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          second.id,
          userId,
        ),
      );
      const secondReceipt = secondReceipts[0];
      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      const userMessages = messages.filter(({ role }) => role === 'user');

      expect(first?.id).toBe(firstRun.id);
      expect(secondReceipt?.systemPrompt).toBe(firstReceipt?.systemPrompt);
      expectMessageParts(userMessages.at(-1)?.parts ?? [], [
        { type: 'text', text: 'withdrawn target turn' },
      ]);
    });

    it('initializes on the first accepted run after re-enabling, with no pre-baseline append', async () => {
      await seedEligibleChat(userId, 'Re-enable source', 'retroactive opening');
      systemPrompt =
        'Base.{{#each chats.recent}} {{title}}|{{excerpt}}{{/each}}';
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'setting is off');
      await finishActive(chatId);
      const before = await tenantDb.runAs(userId, async (tx) => ({
        chat: await new ChatsRepository(tx).findById(chatId, userId),
        messages: await new MessagesRepository(tx).findByChatId(chatId, userId),
      }));
      const beforeUserMessages = before.messages.filter(
        ({ role }) => role === 'user',
      );
      expect(before.chat?.recencyDigestBaseline).toBeNull();
      expect(before.chat?.recencyDigestTold).toBeNull();
      expectMessageParts(beforeUserMessages[0]?.parts ?? [], [
        { type: 'text', text: 'setting is off' },
      ]);

      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await send(chatId, crypto.randomUUID(), 'setting is on again');
      await finishActive(chatId);
      const after = await tenantDb.runAs(userId, async (tx) => ({
        chat: await new ChatsRepository(tx).findById(chatId, userId),
        messages: await new MessagesRepository(tx).findByChatId(chatId, userId),
      }));
      const afterUserMessages = after.messages.filter(
        ({ role }) => role === 'user',
      );
      expect(after.chat?.recencyDigestBaseline?.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Re-enable source' }),
        ]),
      );
      expect(after.chat?.recencyDigestTold).not.toBeNull();
      expectMessageParts(afterUserMessages[1]?.parts ?? [], [
        { type: 'text', text: 'setting is on again' },
      ]);
    });

    it('lets only one concurrent initializing send bind a baseline', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await seedEligibleChat(userId, 'Concurrent source', 'one candidate');
      systemPrompt =
        'Base.{{#each chats.recent}} {{title}}|{{excerpt}}{{/each}}';
      const chatId = crypto.randomUUID();

      const results = await Promise.allSettled([
        send(chatId, crypto.randomUUID(), 'concurrent A'),
        send(chatId, crypto.randomUUID(), 'concurrent B'),
      ]);
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      await finishActive(chatId);
      const [chat, runs] = await tenantDb.runAs(userId, async (tx) => [
        await new ChatsRepository(tx).findById(chatId, userId),
        await new RunsRepository(tx).findByChatId(chatId, userId),
      ]);
      expect(chat?.recencyDigestBaseline).not.toBeNull();
      expect(chat?.recencyDigestTold).not.toBeNull();
      expect(runs).toHaveLength(1);
      const receipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          runs[0].id,
          userId,
        ),
      );
      expect(receipts).toHaveLength(1);
    });

    it('keeps another owner and the empty identity out of digest resolution', async () => {
      const otherUserId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${otherUserId}, 'Digest Other', ${`digest-other-${otherUserId}@test.com`})`;
      try {
        await seedEligibleChat(userId, 'Owner-visible title', 'owner opening');
        await seedEligibleChat(
          otherUserId,
          'OTHER OWNER SECRET TITLE',
          'OTHER OWNER SECRET EXCERPT',
        );
        const resolver = new RecencyDigestService(tenantDb);

        const own = await resolver.resolveCandidate(
          userId,
          crypto.randomUUID(),
        );
        expect(JSON.stringify(own.baseline)).toContain('Owner-visible title');
        expect(JSON.stringify(own.baseline)).not.toMatch(
          /OTHER OWNER SECRET TITLE|OTHER OWNER SECRET EXCERPT/,
        );
        await expect(
          resolver.resolveCandidate('', crypto.randomUUID()),
        ).rejects.toThrow('requires a non-empty userId');
      } finally {
        await sql`DELETE FROM users WHERE id = ${otherUserId}`;
      }
    });

    it('rejects re-submitting an already-accepted message id — a message never produces two runs', async () => {
      const chatId = crypto.randomUUID();
      const messageId = crypto.randomUUID();

      await send(chatId, messageId, 'first send');
      const afterFirst = await activeRun(chatId);
      expect(afterFirst).toBeDefined();

      await expect(
        send(chatId, messageId, 'retry same id'),
      ).rejects.toBeInstanceOf(ConflictException);

      // No second run was created for the chat — still exactly the one.
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(afterFirst!.id);
      expect(dispatchCalls).toHaveLength(1);
    });

    it('409s a DIFFERENT message while a non-terminal run is in flight for the chat, and leaves the blocker untouched', async () => {
      const chatId = crypto.randomUUID();
      const rejectedMessageId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'blocker');
      const blocker = await activeRun(chatId);
      expect(blocker).toBeDefined();

      await expect(
        send(chatId, rejectedMessageId, 'a different message'),
      ).rejects.toBeInstanceOf(ConflictException);

      // The blocker is exactly as it was — a FRESH blocker (well within the
      // run budget) is never expired here; only a blocker stuck past
      // timeoutSeconds + heartbeatSeconds is (see the next test).
      const stillBlocking = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(blocker!.id, userId),
      );
      expect(stillBlocking?.status).toBe(blocker!.status);
      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      expect(messages.some(({ id }) => id === rejectedMessageId)).toBe(false);
      expect(dispatchCalls).toHaveLength(1);
    });

    it('expires a STUCK blocker (no active job, aged past the run budget) and admits the new message', async () => {
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'blocker that will get stuck');
      const blocker = await activeRun(chatId);
      expect(blocker).toBeDefined();

      // Simulate the "no active job" wedge (a crash between the run-row commit
      // and enqueue, or a job never picked up): the run is non-terminal but its
      // last sign of life is older than the longest a real run could take
      // (timeoutSeconds + heartbeatSeconds = 315s). pg-boss can't recover it —
      // there is no active job — so the admission path must free the slot.
      await tenantDb.runAs(userId, (tx) =>
        tx
          .update(schema.runs)
          .set({ createdAt: new Date(Date.now() - 400_000), startedAt: null })
          .where(eq(schema.runs.id, blocker!.id)),
      );

      const retryMessageId = crypto.randomUUID();
      await expect(
        send(chatId, retryMessageId, 'a different message unwedges the chat'),
      ).resolves.toBeDefined();

      // The stuck blocker is now terminal (expired by the admission path) with
      // a run.expired event, and a fresh run was created + dispatched.
      const expired = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(blocker!.id, userId),
      );
      expect(expired?.status).toBe('expired');
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(blocker!.id, userId),
      );
      expect(events.map((e) => e.eventType)).toContain('run.expired');
      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      expect(messages.map(({ seq }) => seq)).toEqual([1, 2]);
      expect(dispatchCalls).toHaveLength(2);
    });

    it('succeeds when the blocker vanishes during the pre-allocation admission check', async () => {
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'blocker');
      const blocker = await activeRun(chatId);
      expect(blocker).toBeDefined();

      // Deterministically stand in for a blocker that becomes terminal between
      // the pre-allocation observation and its conflict decision: return the
      // blocker once, then have a genuinely separate committed writer mark it
      // terminal during the immediate re-check — no sleep/timing.
      // Restores the prototype's real implementation before re-invoking it,
      // rather than grabbing the unbound method and re-dispatching it with
      // `.call`/`.apply`/`Reflect.apply` — this project's
      // strictBindCallApply:false makes `.call`/`.apply` fall through to
      // the untyped legacy Function overload (silently `any`), and
      // Reflect.apply bypasses ordinary typed calls entirely. `mockRestore`
      // then a plain `this.findActiveByChatId(...)` call is both simpler
      // and fully typed: only the re-check invocation is intercepted
      // (mockImplementationOnce), so restoring before re-invoking is safe.
      const spy = vi
        .spyOn(RunsRepository.prototype, 'findActiveByChatId')
        .mockResolvedValueOnce(blocker)
        .mockImplementationOnce(async function (
          this: RunsRepository,
          queriedChatId: string,
          queriedUserId: string,
        ): Promise<Run | undefined> {
          await tenantDb.runAs(queriedUserId, (tx2) =>
            new RunsRepository(tx2).markFinished(
              blocker!.id,
              queriedUserId,
              'cancelled',
            ),
          );
          spy.mockRestore();
          return this.findActiveByChatId(queriedChatId, queriedUserId);
        });

      try {
        const retryMessageId = crypto.randomUUID();
        await expect(
          send(
            chatId,
            retryMessageId,
            'a different message, blocker just vanished',
          ),
        ).resolves.toBeDefined();
      } finally {
        spy.mockRestore();
      }

      // The blocker is now terminal (by the spy's side effect, not by
      // chat-loop) and a SECOND run was created and dispatched for the new
      // message — the retry succeeded rather than 409ing.
      const finishedBlocker = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(blocker!.id, userId),
      );
      expect(finishedBlocker?.status).toBe('cancelled');

      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      expect(runs).toHaveLength(2);
      expect(dispatchCalls).toHaveLength(2);
    });

    it('rolls back the message, run, and event together when run.created fails', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await seedEligibleChat(
        userId,
        'Rollback digest source',
        'private opening',
      );
      const uniquePrompt = `Rollback prompt ${crypto.randomUUID()}`;
      const models: ModelSelectionValidator = {
        validateModelSelection: (modelId: string) => ({
          id: modelId,
          source: 'system',
          contextWindowTokens: 128_000,
          provider: 'openai',
          providerModelId: modelId,
          systemPromptTemplate: uniquePrompt,
          systemPromptSource: 'model_override',
          referencesSkills: false,
        }),
        // No reasoning vocabulary on these doubles: effort always resolves
        // to "none".
        resolveEffortSelection: () => undefined,
      };
      const dispatchRun = vi
        .fn<RunDispatcher['dispatch']>()
        .mockResolvedValue(undefined);
      const dispatch: RunDispatcher = {
        dispatch: dispatchRun,
      };
      const instanceConfig: InstanceConfigReader = {
        config: {
          ...BUILT_IN_DEFAULTS,
          runs: {
            ...BUILT_IN_DEFAULTS.runs,
            timeoutSeconds: 300,
            heartbeatSeconds: 15,
          },
          tools: {
            ...BUILT_IN_DEFAULTS.tools,
            allowed: [],
            callTimeoutSeconds: 15,
          },
        },
      };
      const failingLoop = new ChatLoopService(
        tenantDb,
        models,
        instanceConfig,
        { createUiMessageStreamResponse: vi.fn() },
        new RunAbortRegistry(),
        dispatch,
      );
      const before = await tenantDb.runAs(userId, async (tx) => ({
        chats: (await tx.select().from(schema.chats)).length,
        messages: (await tx.select().from(schema.messages)).length,
        receipts: (await tx.select().from(schema.systemPromptReceipts)).length,
        runs: (await tx.select().from(schema.runs)).length,
        events: (await tx.select().from(schema.runEvents)).length,
      }));
      const append = vi
        .spyOn(RunEventsRepository.prototype, 'append')
        .mockRejectedValueOnce(new Error('forced run.created failure'));

      const targetChatId = crypto.randomUUID();
      try {
        await expect(
          failingLoop.createMessageStream({
            chatId: targetChatId,
            userId,
            modelId: 'system:openai:gpt-5.4-mini',
            message: {
              id: crypto.randomUUID(),
              parts: [{ type: 'text', text: 'must roll back' }],
            },
          }),
        ).rejects.toThrow('forced run.created failure');
      } finally {
        append.mockRestore();
      }

      const after = await tenantDb.runAs(userId, async (tx) => ({
        chats: (await tx.select().from(schema.chats)).length,
        messages: (await tx.select().from(schema.messages)).length,
        receipts: (await tx.select().from(schema.systemPromptReceipts)).length,
        runs: (await tx.select().from(schema.runs)).length,
        events: (await tx.select().from(schema.runEvents)).length,
      }));
      expect(after).toEqual(before);
      expect(dispatchRun).not.toHaveBeenCalled();

      // Stated rather than left implicit: the owner had sharing enabled and an
      // eligible source chat, so a baseline candidate really was resolved
      // before the bind failed. The requirement is that a failed bind leaves
      // NO baseline behind — here the chat row itself never commits, so the
      // next send resolves afresh.
      const rolledBack = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(targetChatId, userId),
      );
      expect(rolledBack).toBeUndefined();
    });

    it('leaves a pre-existing digest told-set unchanged when its append fails to bind', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      const target = await tenantDb.runAs(userId, async (tx) => {
        const chats = new ChatsRepository(tx);
        const chat = await chats.create({
          ownerUserId: userId,
          title: 'Target',
        });
        await chats.setRecencyDigestIfAbsent(
          chat.id,
          userId,
          {
            pinned: [],
            recent: [],
            pinnedShown: 0,
            pinnedTotal: 0,
            recentShown: 0,
            recentTotal: 0,
            compiledOn: '2026-08-13',
          },
          [],
        );
        return chat;
      });
      await seedEligibleChat(userId, 'Event source', 'opening');
      const append = vi
        .spyOn(RunEventsRepository.prototype, 'append')
        .mockRejectedValueOnce(new Error('forced append failure'));

      try {
        await expect(
          send(target.id, crypto.randomUUID(), 'must roll back append'),
        ).rejects.toThrow('forced append failure');
      } finally {
        append.mockRestore();
      }

      const after = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(target.id, userId),
      );
      expect(after?.recencyDigestTold).toEqual([]);
    });

    it('persists worker-owned context only on successful model turns and fences a model-change marker to its run', async () => {
      const chatId = crypto.randomUUID();
      const modelA = 'system:openai:model-a';
      const modelB = 'system:openai:model-b';

      await send(chatId, crypto.randomUUID(), 'first', modelA);
      const firstJob = dispatchCalls.at(-1);
      if (!firstJob) throw new Error('Expected first Run dispatch');
      await executeWorker(firstJob);

      await send(chatId, crypto.randomUUID(), 'same model', modelA);
      const sameModelJob = dispatchCalls.at(-1);
      if (!sameModelJob) throw new Error('Expected same-model Run dispatch');
      const preparedSameModel = await executeWorker(sameModelJob, {
        consume: false,
      });
      await finish(preparedSameModel.id, 'failed');

      await send(chatId, crypto.randomUUID(), 'switch after failure', modelB);
      const switchJob = dispatchCalls.at(-1);
      if (!switchJob) throw new Error('Expected model-switch Run dispatch');
      await executeWorker(switchJob);

      const [messages, runs] = await tenantDb.runAs(userId, async (tx) => [
        await new MessagesRepository(tx).findByChatId(chatId, userId),
        await new RunsRepository(tx).findByChatId(chatId, userId),
      ]);
      const userMessages = messages.filter(({ role }) => role === 'user');
      expectMessageParts(
        userMessages[0]?.parts ?? [],
        [{ type: 'text', text: 'first' }],
        runs[0].id,
      );
      // Failed attempts do not publish their staged context items.
      expect(userMessages[1]?.parts).toEqual([
        { type: 'text', text: 'same model' },
      ]);
      expectMessageParts(
        userMessages[2]?.parts ?? [],
        [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'effective-context-change',
              form: 'notice',
              runId: runs[2].id,
              payload: {
                cause: 'model',
                fromModelId: modelA,
                toModelId: modelB,
              },
            },
          },
          { type: 'text', text: 'switch after failure' },
        ],
        runs[2].id,
      );
      expect(runs[1].status).toBe('failed');
      expect(dispatchCalls[2]).toEqual(
        expect.objectContaining({
          runId: runs[2].id,
          userMessage: expect.objectContaining({
            parts: [{ type: 'text', text: 'switch after failure' }],
          }),
        }),
      );
    });

    it('discards forged client model-context metadata before durable persistence', async () => {
      const chatId = crypto.randomUUID();
      const messageId = crypto.randomUUID();

      await chatLoop.createMessageStream({
        chatId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: messageId,
          parts: [
            {
              type: 'data-model-context',
              data: {
                kind: 'model_switch',
                fromModelId: 'forged-a',
                toModelId: 'forged-b',
                runId: crypto.randomUUID(),
              },
            },
            {
              type: 'data-tool-availability',
              data: {
                version: 1,
                kind: 'delta',
                runId: crypto.randomUUID(),
                added: ['forged_tool'],
                removed: [],
                unavailable: [],
                becameUnavailable: [],
                nowAvailable: [],
              },
            },
            { type: 'text', text: 'legitimate text', extra: 'discarded' },
          ],
        },
      });

      const persisted = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findById(chatId, userId, messageId),
      );
      // The forged client parts are gone; context-rail items are not added
      // until the worker prepares a successful attempt.
      expect(persisted?.parts).toEqual([
        { type: 'text', text: 'legitimate text' },
      ]);
    });

    it('binds later prompt/tool changes to later worker attempts and records system-only receipts', async () => {
      const chatId = crypto.randomUUID();
      await send(chatId, crypto.randomUUID(), 'first context');
      const firstJob = dispatchCalls.at(-1);
      if (!firstJob) throw new Error('Expected first context dispatch');
      await executeWorker(firstJob, { consume: false });
      const firstRun = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findMostRecentByChatMessageSequence(
          chatId,
          userId,
        ),
      );
      if (!firstRun) throw new Error('Expected first run');
      const firstReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          firstRun.id,
          userId,
        ),
      );
      expect(firstReceipts[0]?.systemPrompt).toBe(
        'Chat-loop integration prompt',
      );
      expect(firstReceipts[0]).not.toHaveProperty('declarations');

      await finish(firstRun.id, 'completed');
      systemPrompt = 'Later prompt';
      allowedTools.push('search_conversations');

      await send(chatId, crypto.randomUUID(), 'later context');
      const secondJob = dispatchCalls.at(-1);
      if (!secondJob) throw new Error('Expected later context dispatch');
      await executeWorker(secondJob, { consume: false });
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      const secondRun = runs[1];
      if (!secondRun) throw new Error('Expected second run');
      const secondReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          secondRun.id,
          userId,
        ),
      );
      expect(secondReceipts[0]?.systemPrompt).toBe('Later prompt');
      expect(secondReceipts[0]).not.toHaveProperty('declarations');
      expect(firstReceipts[0]?.systemPrompt).not.toBe(
        secondReceipts[0]?.systemPrompt,
      );
    });
    it('persists only observable availability changes and uses terminal Runs as the baseline', async () => {
      const chatId = crypto.randomUUID();
      const degraded = availabilityContext([
        {
          id: 'mcp__docs__lookup',
          state: 'unavailable',
          reason: 'source_disconnected',
        },
      ]);
      const changedDiagnostic = availabilityContext([
        {
          id: 'mcp__docs__lookup',
          state: 'unavailable',
          reason: 'source_connecting',
        },
      ]);
      const healthy = availabilityContext([
        { id: 'mcp__docs__lookup', state: 'available' },
      ]);
      const empty = availabilityContext([]);

      const first = await persistWithContext(
        chatId,
        'first degraded turn',
        degraded,
      );
      const firstAvailability = availabilityRunItem(first.run);
      expect(firstAvailability).toMatchObject({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      });
      expect(firstAvailability?.text).toContain('mcp__docs__lookup');
      expect(firstAvailability?.text).toContain('server disconnected');
      await finish(first.runId, 'failed');

      const unchangedOutage = await persistWithContext(
        chatId,
        'same outage with a changed internal reason',
        changedDiagnostic,
      );
      const unchangedOutageAvailability = availabilityRunItem(
        unchangedOutage.run,
      );
      expect(unchangedOutageAvailability).toMatchObject({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      });
      expect(unchangedOutageAvailability?.text).toContain('mcp__docs__lookup');
      expect(unchangedOutageAvailability?.text).toContain('server connecting');
      await finish(unchangedOutage.runId, 'completed', [
        { id: 'mcp__docs__lookup', state: 'unavailable' },
      ]);

      const recovered = await persistWithContext(
        chatId,
        'tool recovered',
        healthy,
      );
      const recoveredAvailability = availabilityRunItem(recovered.run);
      expect(recoveredAvailability).toMatchObject({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      });
      expect(recoveredAvailability?.text).toContain('mcp__docs__lookup');
      expect(recoveredAvailability?.text).toContain('tool restored');
      await finish(recovered.runId, 'cancelled');

      const transientFlap = await persistWithContext(
        chatId,
        'disconnect and reconnect between attempts',
        healthy,
      );
      expect(availabilityRunItem(transientFlap.run)).toBeUndefined();
      await finish(transientFlap.runId, 'expired');

      const removed = await persistWithContext(chatId, 'tool removed', empty);
      const removedAvailability = availabilityRunItem(removed.run);
      // The expired predecessor cannot establish a baseline; an empty fresh
      // epoch has no unavailable tools to disclose.
      expect(removedAvailability).toBeUndefined();
      await finish(removed.runId, 'completed', []);

      const newlyUnavailable = await persistWithContext(
        chatId,
        'newly eligible but unavailable',
        degraded,
      );
      const newlyUnavailableAvailability = availabilityRunItem(
        newlyUnavailable.run,
      );
      expect(newlyUnavailableAvailability).toMatchObject({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      });
      expect(newlyUnavailableAvailability?.text).toContain('mcp__docs__lookup');

      const receipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          newlyUnavailable.runId,
          userId,
        ),
      );
      expect(receipts[0]?.systemPrompt).toEqual(expect.any(String));
      expect(receipts[0]).not.toHaveProperty('availabilityManifest');
    });

    it('serializes the availability baseline read with concurrent accepted turns', async () => {
      const chatId = crypto.randomUUID();
      const healthy = availabilityContext([
        { id: 'mcp__docs__lookup', state: 'available' },
      ]);
      const degraded = availabilityContext([
        {
          id: 'mcp__docs__lookup',
          state: 'unavailable',
          reason: 'source_disconnected',
        },
      ]);
      const baseline = await persistWithContext(
        chatId,
        'healthy baseline',
        healthy,
      );
      await finish(baseline.runId, 'completed', [
        { id: 'mcp__docs__lookup', state: 'available' },
      ]);

      const gate = () => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        return { promise, release };
      };
      const firstLocked = gate();
      const releaseFirst = gate();
      const secondCalled = gate();
      const secondLocked = gate();
      const releaseSecond = gate();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately captured unbound and re-invoked with an explicit receiver below.
      const originalTouch = ChatsRepository.prototype.touch;
      let touchCalls = 0;
      const touch = vi
        .spyOn(ChatsRepository.prototype, 'touch')
        .mockImplementation(async function (
          this: ChatsRepository,
          queriedChatId: string,
          queriedUserId: string,
        ): Promise<Awaited<ReturnType<ChatsRepository['touch']>>> {
          touchCalls += 1;
          if (touchCalls === 2) secondCalled.release();
          // Keep the real return value: `touch` now hands back the post-lock
          // row, and the caller renders from it.
          const touched: Awaited<ReturnType<ChatsRepository['touch']>> =
            await originalTouch.call(this, queriedChatId, queriedUserId);
          if (touchCalls === 1) {
            firstLocked.release();
            await releaseFirst.promise;
          } else {
            secondLocked.release();
            await releaseSecond.promise;
          }
          return touched;
        });
      const resolve = vi
        .spyOn(effectiveContextResolver, 'resolveEffectiveContext')
        .mockResolvedValueOnce(degraded)
        .mockResolvedValueOnce(healthy);
      const degradedMessageId = crypto.randomUUID();
      const recoveredMessageId = crypto.randomUUID();

      try {
        const degradedTurn = send(
          chatId,
          degradedMessageId,
          'concurrent degradation',
        );
        await firstLocked.promise;
        const recoveredTurn = send(
          chatId,
          recoveredMessageId,
          'concurrent recovery',
        );
        await secondCalled.promise;

        releaseFirst.release();
        await degradedTurn;
        await secondLocked.promise;
        const degradedJob = dispatchCalls.find(
          ({ userMessage }) => userMessage.id === degradedMessageId,
        );
        if (!degradedJob) throw new Error('Expected degraded Run dispatch');
        await executeWorker(degradedJob, {
          consume: false,
        });
        await finish(degradedJob.runId, 'completed', [
          { id: 'mcp__docs__lookup', state: 'unavailable' },
        ]);
        releaseSecond.release();
        await recoveredTurn;

        const recoveredJob = dispatchCalls.find(
          ({ userMessage }) => userMessage.id === recoveredMessageId,
        );
        if (!recoveredJob) throw new Error('Expected recovered Run dispatch');
        const preparedRecovered = await executeWorker(recoveredJob, {
          consume: false,
        });
        const recoveredAvailability = availabilityRunItem(preparedRecovered);
        expect(recoveredAvailability).toMatchObject({
          producer: 'tool-availability',
          form: 'notice',
          residency: 'rail',
        });
        expect(recoveredAvailability?.text).toContain('tool restored');
        await finish(recoveredJob.runId);
      } finally {
        releaseFirst.release();
        releaseSecond.release();
        touch.mockRestore();
        resolve.mockRestore();
      }
    });

    it('treats legacy-unobserved and post-compaction turns as fresh disclosure epochs', async () => {
      const legacyChat = await tenantDb.runAs(userId, async (tx) => {
        const chat = await new ChatsRepository(tx).create({
          ownerUserId: userId,
        });
        const message = await new MessagesRepository(
          tx,
        ).createUserMessageIfAbsent({
          id: crypto.randomUUID(),
          chatId: chat.id,
          senderUserId: userId,
          parts: [{ type: 'text', text: 'historical turn' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId: chat.id,
          messageId: message!.id,
          userId,
          modelId: 'system:openai:gpt-5.4-mini',
        });
        await new RunsRepository(tx).markFinished(run.id, userId, 'completed');
        return chat.id;
      });
      const healthy = availabilityContext([
        { id: 'mcp__docs__lookup', state: 'available' },
      ]);
      const afterLegacy = await persistWithContext(
        legacyChat,
        'first observed healthy turn',
        healthy,
      );
      expect(availabilityRunItem(afterLegacy.run)).toBeUndefined();
      const observedReceipts = await tenantDb.runAs(userId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          afterLegacy.runId,
          userId,
        ),
      );
      expect(observedReceipts[0]?.systemPrompt).toEqual(expect.any(String));
      expect(observedReceipts[0]).not.toHaveProperty('availabilityManifest');

      const degradedChatId = crypto.randomUUID();
      const beforeCompaction = await persistWithContext(
        degradedChatId,
        'healthy before compaction',
        healthy,
      );
      await finish(beforeCompaction.runId, 'completed', [
        { id: 'mcp__docs__lookup', state: 'available' },
      ]);
      await tenantDb.runAs(userId, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: degradedChatId,
          uptoSeq: beforeCompaction.userMessage.seq,
          summary: 'A prior tool outage mattered historically.',
          replacementHistory: compactionReplacementHistory(
            'A prior tool outage mattered historically.',
          ),
        }),
      );
      const degraded = availabilityContext([
        {
          id: 'mcp__docs__lookup',
          state: 'unavailable',
          reason: 'source_disconnected',
        },
      ]);
      const firstAfterCompaction = await persistWithContext(
        degradedChatId,
        'degraded after compaction',
        degraded,
      );
      const firstAfterAvailability = availabilityRunItem(
        firstAfterCompaction.run,
      );
      expect(firstAfterAvailability).toMatchObject({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      });
      expect(firstAfterAvailability?.text).toContain('mcp__docs__lookup');
      expect(firstAfterAvailability?.text).toContain('server disconnected');
      await finish(firstAfterCompaction.runId, 'completed', [
        { id: 'mcp__docs__lookup', state: 'unavailable' },
      ]);
      const repeated = await persistWithContext(
        degradedChatId,
        'unchanged after new epoch baseline',
        degraded,
      );
      expect(availabilityRunItem(repeated.run)).toBeUndefined();

      const healthyChatId = crypto.randomUUID();
      const degradedBefore = await persistWithContext(
        healthyChatId,
        'degraded before healthy epoch',
        degraded,
      );
      await finish(degradedBefore.runId, 'completed', [
        { id: 'mcp__docs__lookup', state: 'unavailable' },
      ]);
      await tenantDb.runAs(userId, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: healthyChatId,
          uptoSeq: degradedBefore.userMessage.seq,
          summary: 'Historical outage summary.',
          replacementHistory: compactionReplacementHistory(
            'Historical outage summary.',
          ),
        }),
      );
      const healthyAfterCompaction = await persistWithContext(
        healthyChatId,
        'healthy after compaction',
        healthy,
      );
      expect(availabilityRunItem(healthyAfterCompaction.run)).toBeUndefined();
    });

    it('does not commit a prospective availability baseline when the worker fails, then commits it on success', async () => {
      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      const chatId = crypto.randomUUID();
      const degraded = availabilityContext([
        {
          id: 'mcp__docs__lookup',
          state: 'unavailable',
          reason: 'discovery_failed',
        },
      ]);

      const failedResolve = vi
        .spyOn(effectiveContextResolver, 'resolveEffectiveContext')
        .mockResolvedValueOnce(degraded);
      let failedRun: Run;
      try {
        await send(chatId, crypto.randomUUID(), 'worker failure');
        const failedJob = dispatchCalls.at(-1);
        if (!failedJob) throw new Error('Expected failed Run dispatch');
        failedRun = await executeWorker(failedJob, { fail: true });
      } finally {
        failedResolve.mockRestore();
      }
      if (failedRun.status !== 'failed') {
        await finish(failedRun.id, 'failed');
      }

      const afterFailure = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(chatId, userId),
      );
      expect(afterFailure?.recencyDigestBaseline).toBeNull();
      expect(afterFailure?.recencyDigestTold).toBeNull();

      const successfulResolve = vi
        .spyOn(effectiveContextResolver, 'resolveEffectiveContext')
        .mockResolvedValueOnce(degraded);
      let successfulRun: Run;
      try {
        await send(chatId, crypto.randomUUID(), 'accepted after failure');
        const successfulJob = dispatchCalls.at(-1);
        if (!successfulJob) throw new Error('Expected successful Run dispatch');
        successfulRun = await executeWorker(successfulJob);
      } finally {
        successfulResolve.mockRestore();
      }

      const afterSuccess = await tenantDb.runAs(userId, async (tx) => ({
        chat: await new ChatsRepository(tx).findById(chatId, userId),
        messages: await new MessagesRepository(tx).findByChatId(chatId, userId),
      }));
      expect(afterSuccess.chat?.recencyDigestBaseline).not.toBeNull();
      expect(afterSuccess.chat?.recencyDigestTold).not.toBeNull();
      const userMessages = afterSuccess.messages.filter(
        ({ role }) => role === 'user',
      );
      expectMessageParts(
        userMessages[1]?.parts ?? [],
        [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'tool-availability',
              form: 'notice',
              runId: successfulRun.id,
              payload: {
                kind: 'initial',
                added: [],
                removed: [],
                unavailable: [
                  { id: 'mcp__docs__lookup', reason: 'discovery_failed' },
                ],
                becameUnavailable: [],
                nowAvailable: [],
              },
            },
          },
          { type: 'text', text: 'accepted after failure' },
        ],
        successfulRun.id,
      );
    });
  },
);
