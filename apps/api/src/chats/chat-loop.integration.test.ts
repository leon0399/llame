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
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type ModelSelectionValidator } from '../models/models.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { type RunJob } from '../runs/run-queues';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { ChatLoopService } from './chat-loop.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from './recency-digest.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { createModelPromptLoader } from '../instance-config/prompt-loader';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import {
  canonicalJson,
  type EffectiveContextSnapshotInput,
} from '../runs/effective-context-resolver';
import * as effectiveContextResolver from '../runs/effective-context-resolver';
import { hashWithDomain } from '../canonical-json';
import {
  hashToolAvailabilityManifest,
  TOOL_AVAILABILITY_UNOBSERVED,
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';
import { type ContextItemPart } from './context-item';
import { createToolAvailabilityItem } from './context-item-producers';
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

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

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

    type AvailabilityState =
      | { id: string; state: 'available' }
      | {
          id: string;
          state: 'unavailable';
          reason: ToolUnavailableReason;
        };

    function availabilityContext(
      states: ReadonlyArray<AvailabilityState>,
      key: string,
    ): EffectiveContextSnapshotInput {
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
      const manifest: ToolAvailabilityManifestV1 = {
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
      const prompt = `Availability integration prompt ${key}`;
      const canonicalTools = canonicalJson(toolDeclarations);
      return {
        availabilityHash: hashToolAvailabilityManifest(manifest),
        promptHash: hashWithDomain('llame:model-context:prompt:v1', prompt),
        toolHash: hashWithDomain(
          'llame:model-context:tools:v1',
          canonicalTools,
        ),
        contentHash: hashWithDomain(
          'llame:model-context:content:v1',
          canonicalJson({ systemPrompt: prompt, toolDeclarations }),
        ),
        source: 'project_default',
        systemPrompt: prompt,
        toolAvailabilityManifest: manifest,
        toolDeclarations,
      };
    }

    type PersistResult = {
      runId: string;
      userMessage: {
        id: string;
        seq: number;
        parts: Array<unknown>;
      };
    };

    const persistWithContext = (
      chatId: string,
      text: string,
      effectiveContext: EffectiveContextSnapshotInput,
      modelId = 'system:openai:gpt-5.4-mini',
    ): Promise<PersistResult> => {
      // Supply a source-neutral manifest through the public turn path. PR1's
      // production resolver has only code-owned candidates; PR4 will make these
      // degraded states reachable from the live MCP catalog.
      const resolve = vi
        .spyOn(effectiveContextResolver, 'resolveEffectiveContext')
        .mockResolvedValueOnce(effectiveContext);
      return chatLoop
        .createMessageStream({
          chatId,
          userId,
          modelId,
          message: {
            id: crypto.randomUUID(),
            parts: [{ type: 'text', text }],
          },
        })
        .then(() => {
          const job = dispatchCalls.at(-1);
          if (!job) throw new Error('Expected accepted Run dispatch');
          return {
            runId: job.runId,
            userMessage: job.userMessage,
          };
        })
        .finally(() => resolve.mockRestore());
    };

    const availabilityPart = (
      parts: ReadonlyArray<unknown>,
    ): ContextItemPart | undefined =>
      parts.find(
        (part): part is ContextItemPart =>
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'data-context' &&
          'data' in part &&
          typeof part.data === 'object' &&
          part.data !== null &&
          'producer' in part.data &&
          part.data.producer === 'tool-availability',
      );

    const finish = (
      runId: string,
      status: 'completed' | 'failed' | 'cancelled' | 'expired' = 'completed',
    ) =>
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(runId, userId, status),
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
        new PersonalizationService(tenantDb),
        new SystemPromptsService(),
        { snapshotCandidates: () => [] },
        new MemoryService(tenantDb),
        new RecencyDigestService(tenantDb),
        knowledgeCandidates,
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
      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(run.id, userId, 'completed'),
      );
      return run;
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

    it('freezes one baseline and reuses its snapshot on the second run', async () => {
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
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );

      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe(firstRun.id);
      expect(runs[1].modelContextSnapshotId).toBe(
        runs[0].modelContextSnapshotId,
      );
      const secondSnapshot = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          runs[1].id,
          userId,
        ),
      );
      expect(secondSnapshot?.systemPrompt).not.toContain('Later source');
      expect(secondSnapshot?.systemPrompt).not.toContain('must stay absent');
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
      const firstReceipt = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          firstRun.id,
          userId,
        ),
      );
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
      const [first, second] = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      const secondReceipt = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          second.id,
          userId,
        ),
      );
      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );

      expect(first?.id).toBe(firstRun.id);
      expect(secondReceipt?.systemPrompt).toBe(firstReceipt?.systemPrompt);
      expect(secondReceipt?.systemPrompt).not.toContain('Withheld new source');
      expectMessageParts(messages.at(-1)?.parts ?? [], [
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
      expect(before.chat?.recencyDigestBaseline).toBeNull();
      expect(before.chat?.recencyDigestTold).toBeNull();
      expectMessageParts(before.messages[0].parts, [
        { type: 'text', text: 'setting is off' },
      ]);

      await new MemoryService(tenantDb).updateForOwner(userId, {
        shareRecentChats: true,
      });
      await send(chatId, crypto.randomUUID(), 'setting is on again');
      const after = await tenantDb.runAs(userId, async (tx) => ({
        chat: await new ChatsRepository(tx).findById(chatId, userId),
        messages: await new MessagesRepository(tx).findByChatId(chatId, userId),
      }));
      expect(after.chat?.recencyDigestBaseline?.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Re-enable source' }),
        ]),
      );
      expect(after.chat?.recencyDigestTold).not.toBeNull();
      expectMessageParts(after.messages[1].parts, [
        { type: 'text', text: 'setting is on again' },
      ]);
    });

    it('lets only one concurrent initializing send bind a baseline and snapshot', async () => {
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
      const [chat, runs] = await tenantDb.runAs(userId, async (tx) => [
        await new ChatsRepository(tx).findById(chatId, userId),
        await new RunsRepository(tx).findByChatId(chatId, userId),
      ]);
      expect(chat?.recencyDigestBaseline).not.toBeNull();
      expect(chat?.recencyDigestTold).not.toBeNull();
      expect(runs).toHaveLength(1);
      expect(
        new Set(
          runs.map(({ modelContextSnapshotId }) => modelContextSnapshotId),
        ).size,
      ).toBe(1);
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

    it('rolls back the message, snapshot, run, and event together when run.created fails', async () => {
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
        new PersonalizationService(tenantDb),
        new SystemPromptsService(),
        { snapshotCandidates: () => [] },
        new MemoryService(tenantDb),
        new RecencyDigestService(tenantDb),
        knowledgeCandidates,
      );
      const before = await tenantDb.runAs(userId, async (tx) => ({
        chats: (await tx.select().from(schema.chats)).length,
        messages: (await tx.select().from(schema.messages)).length,
        snapshots: (await tx.select().from(schema.modelContextSnapshots))
          .length,
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
        snapshots: (await tx.select().from(schema.modelContextSnapshots))
          .length,
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

    it('persists no marker for first/same-model turns and a target-run-bound marker after a failed prior model', async () => {
      const chatId = crypto.randomUUID();
      const modelA = 'system:openai:model-a';
      const modelB = 'system:openai:model-b';

      await send(chatId, crypto.randomUUID(), 'first', modelA);
      const [firstRun] = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(firstRun.id, userId, 'completed'),
      );

      await send(chatId, crypto.randomUUID(), 'same model', modelA);
      const [, sameModelRun] = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(sameModelRun.id, userId, 'failed', {
          message: 'provider failed after selection',
        }),
      );

      await send(chatId, crypto.randomUUID(), 'switch after failure', modelB);

      const [messages, runs] = await tenantDb.runAs(userId, async (tx) => [
        await new MessagesRepository(tx).findByChatId(chatId, userId),
        await new RunsRepository(tx).findByChatId(chatId, userId),
      ]);
      // Every turn is dated, including the ones carrying no other item.
      expectMessageParts(
        messages[0].parts,
        [{ type: 'text', text: 'first' }],
        runs[0].id,
      );
      expectMessageParts(
        messages[1].parts,
        [{ type: 'text', text: 'same model' }],
        runs[1].id,
      );
      expectMessageParts(
        messages[2].parts,
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
          userMessage: expect.objectContaining({ parts: messages[2].parts }),
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
      // The forged client parts are gone; the server's own temporal row is
      // the only non-text part that survives persistence.
      expectMessageParts(persisted?.parts ?? [], [
        { type: 'text', text: 'legitimate text' },
      ]);
    });

    it('binds later prompt/tool changes only to later runs and keeps a reclaimed run on its original snapshot', async () => {
      const chatId = crypto.randomUUID();
      await send(chatId, crypto.randomUUID(), 'first context');
      const [firstRun] = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      const firstSnapshot = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          firstRun.id,
          userId,
        ),
      );
      expect(firstSnapshot?.systemPrompt).toBe('Chat-loop integration prompt');
      expect(firstSnapshot?.toolDeclarations).toEqual([]);

      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markFinished(firstRun.id, userId, 'completed'),
      );
      systemPrompt = 'Later prompt';
      allowedTools.push('search_conversations');

      await send(chatId, crypto.randomUUID(), 'later context');
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      const secondRun = runs[1];
      const secondSnapshot = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          secondRun.id,
          userId,
        ),
      );

      expect(firstRun.modelContextSnapshotId).toBe(firstSnapshot?.id);
      expect(secondRun.modelContextSnapshotId).toBe(secondSnapshot?.id);
      expect(secondSnapshot?.id).not.toBe(firstSnapshot?.id);
      expect(secondSnapshot?.systemPrompt).toBe('Later prompt');
      expect(secondSnapshot?.toolDeclarations.map(({ id }) => id)).toEqual([
        'search_conversations',
      ]);

      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).markStarted(secondRun.id, userId),
      );
      const reclaimed = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(secondRun.id, userId),
      );
      expect(reclaimed?.modelContextSnapshotId).toBe(secondSnapshot?.id);
      await expect(
        tenantDb.runAs(userId, (tx) =>
          new ModelContextSnapshotsRepository(tx).findByOwnedRun(
            firstRun.id,
            userId,
          ),
        ),
      ).resolves.toEqual(firstSnapshot);
    });

    it('persists only observable availability changes and uses terminal Runs as the baseline', async () => {
      const chatId = crypto.randomUUID();
      const key = crypto.randomUUID();
      const degraded = availabilityContext(
        [
          {
            id: 'mcp__docs__lookup',
            state: 'unavailable',
            reason: 'source_disconnected',
          },
        ],
        key,
      );
      const changedDiagnostic = availabilityContext(
        [
          {
            id: 'mcp__docs__lookup',
            state: 'unavailable',
            reason: 'source_connecting',
          },
        ],
        key,
      );
      const healthy = availabilityContext(
        [{ id: 'mcp__docs__lookup', state: 'available' }],
        key,
      );
      const empty = availabilityContext([], key);

      const first = await persistWithContext(
        chatId,
        'first degraded turn',
        degraded,
      );
      expect(availabilityPart(first.userMessage.parts)).toEqual(
        createToolAvailabilityItem({
          runId: first.runId,
          payload: {
            kind: 'initial',
            added: [],
            removed: [],
            unavailable: [
              {
                id: 'mcp__docs__lookup',
                reason: 'source_disconnected',
              },
            ],
            becameUnavailable: [],
            nowAvailable: [],
          },
        }),
      );
      await finish(first.runId, 'failed');

      const unchangedOutage = await persistWithContext(
        chatId,
        'same outage with a changed internal reason',
        changedDiagnostic,
      );
      expect(
        availabilityPart(unchangedOutage.userMessage.parts),
      ).toBeUndefined();
      await finish(unchangedOutage.runId, 'completed');

      const recovered = await persistWithContext(
        chatId,
        'tool recovered',
        healthy,
      );
      expect(
        availabilityPart(recovered.userMessage.parts)?.data.payload,
      ).toMatchObject({
        kind: 'delta',
        nowAvailable: [
          { id: 'mcp__docs__lookup', reason: 'source_reconnected' },
        ],
      });
      await finish(recovered.runId, 'cancelled');

      const transientFlap = await persistWithContext(
        chatId,
        'disconnect and reconnect between snapshots',
        healthy,
      );
      expect(availabilityPart(transientFlap.userMessage.parts)).toBeUndefined();
      await finish(transientFlap.runId, 'expired');

      const removed = await persistWithContext(chatId, 'tool removed', empty);
      expect(
        availabilityPart(removed.userMessage.parts)?.data.payload,
      ).toMatchObject({
        kind: 'delta',
        removed: ['mcp__docs__lookup'],
      });
      await finish(removed.runId, 'completed');

      const newlyUnavailable = await persistWithContext(
        chatId,
        'newly eligible but unavailable',
        degraded,
      );
      expect(
        availabilityPart(newlyUnavailable.userMessage.parts)?.data.payload,
      ).toMatchObject({
        kind: 'delta',
        added: [],
        unavailable: [
          {
            id: 'mcp__docs__lookup',
            reason: 'source_disconnected',
          },
        ],
      });

      const snapshot = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          newlyUnavailable.runId,
          userId,
        ),
      );
      expect(snapshot?.toolAvailabilityManifest).toEqual(
        degraded.toolAvailabilityManifest,
      );
    });

    it('serializes the availability baseline read with concurrent accepted turns', async () => {
      const chatId = crypto.randomUUID();
      const key = crypto.randomUUID();
      const healthy = availabilityContext(
        [{ id: 'mcp__docs__lookup', state: 'available' }],
        key,
      );
      const degraded = availabilityContext(
        [
          {
            id: 'mcp__docs__lookup',
            state: 'unavailable',
            reason: 'source_disconnected',
          },
        ],
        key,
      );
      const baseline = await persistWithContext(
        chatId,
        'healthy baseline',
        healthy,
      );
      await finish(baseline.runId);

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
        await finish(degradedJob.runId);
        releaseSecond.release();
        await recoveredTurn;

        const recoveredJob = dispatchCalls.find(
          ({ userMessage }) => userMessage.id === recoveredMessageId,
        );
        if (!recoveredJob) throw new Error('Expected recovered Run dispatch');
        expect(
          availabilityPart(recoveredJob.userMessage.parts)?.data.payload,
        ).toMatchObject({
          kind: 'delta',
          nowAvailable: [
            { id: 'mcp__docs__lookup', reason: 'source_reconnected' },
          ],
        });
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
        const [snapshot] = await tx
          .insert(schema.modelContextSnapshots)
          .values({
            ownerUserId: userId,
            availabilityHash: hashToolAvailabilityManifest(
              TOOL_AVAILABILITY_UNOBSERVED,
            ),
            contentHash: `legacy-content-${crypto.randomUUID()}`,
            promptHash: `legacy-prompt-${crypto.randomUUID()}`,
            toolHash: `legacy-tools-${crypto.randomUUID()}`,
            source: 'project_default',
            systemPrompt: 'Historical prompt',
            toolAvailabilityManifest: TOOL_AVAILABILITY_UNOBSERVED,
            toolDeclarations: [],
          })
          .returning();
        const run = await new RunsRepository(tx).create({
          chatId: chat.id,
          messageId: message!.id,
          userId,
          modelId: 'system:openai:gpt-5.4-mini',
          modelContextSnapshotId: snapshot.id,
        });
        await new RunsRepository(tx).markFinished(run.id, userId, 'completed');
        return chat.id;
      });
      const healthy = availabilityContext(
        [{ id: 'mcp__docs__lookup', state: 'available' }],
        crypto.randomUUID(),
      );
      const afterLegacy = await persistWithContext(
        legacyChat,
        'first observed healthy turn',
        healthy,
      );
      expect(availabilityPart(afterLegacy.userMessage.parts)).toBeUndefined();
      const observedSnapshot = await tenantDb.runAs(userId, (tx) =>
        new ModelContextSnapshotsRepository(tx).findByOwnedRun(
          afterLegacy.runId,
          userId,
        ),
      );
      expect(observedSnapshot?.toolAvailabilityManifest).toEqual(
        healthy.toolAvailabilityManifest,
      );

      const degradedChatId = crypto.randomUUID();
      const beforeCompaction = await persistWithContext(
        degradedChatId,
        'healthy before compaction',
        healthy,
      );
      await finish(beforeCompaction.runId);
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
      const degraded = availabilityContext(
        [
          {
            id: 'mcp__docs__lookup',
            state: 'unavailable',
            reason: 'source_disconnected',
          },
        ],
        crypto.randomUUID(),
      );
      const firstAfterCompaction = await persistWithContext(
        degradedChatId,
        'degraded after compaction',
        degraded,
      );
      expect(
        availabilityPart(firstAfterCompaction.userMessage.parts)?.data.payload,
      ).toMatchObject({
        kind: 'initial',
        unavailable: [
          {
            id: 'mcp__docs__lookup',
            reason: 'source_disconnected',
          },
        ],
        becameUnavailable: [],
      });
      await finish(firstAfterCompaction.runId);
      const repeated = await persistWithContext(
        degradedChatId,
        'unchanged after new epoch baseline',
        degraded,
      );
      expect(availabilityPart(repeated.userMessage.parts)).toBeUndefined();

      const healthyChatId = crypto.randomUUID();
      const degradedBefore = await persistWithContext(
        healthyChatId,
        'degraded before healthy epoch',
        degraded,
      );
      await finish(degradedBefore.runId);
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
      expect(
        availabilityPart(healthyAfterCompaction.userMessage.parts),
      ).toBeUndefined();
    });

    it('rolls back a prospective availability baseline before commit', async () => {
      const chatId = crypto.randomUUID();
      const degraded = availabilityContext(
        [
          {
            id: 'mcp__docs__lookup',
            state: 'unavailable',
            reason: 'discovery_failed',
          },
        ],
        crypto.randomUUID(),
      );
      const append = vi
        .spyOn(RunEventsRepository.prototype, 'append')
        .mockRejectedValueOnce(new Error('forced availability commit failure'));
      try {
        await expect(
          persistWithContext(chatId, 'must roll back', degraded),
        ).rejects.toThrow('forced availability commit failure');
      } finally {
        append.mockRestore();
      }

      await expect(
        tenantDb.runAs(userId, (tx) =>
          new ChatsRepository(tx).findById(chatId, userId),
        ),
      ).resolves.toBeUndefined();

      const accepted = await persistWithContext(
        chatId,
        'accepted after rollback',
        degraded,
      );
      expect(
        availabilityPart(accepted.userMessage.parts)?.data.payload,
      ).toMatchObject({
        kind: 'initial',
        unavailable: [{ id: 'mcp__docs__lookup', reason: 'discovery_failed' }],
      });
    });
  },
);
