/**
 * The assistant reply from first dispatch to its terminal write (design D3,
 * D5, D6, D7): a retry resets it in its own dispatch transaction, every
 * terminal writer outside the dispatching attempt settles it from that
 * attempt's events around the stored in-Run items and leaves the chat stale
 * for search, and a switch the Run that stored it failed under is announced
 * once.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isRecord } from '@workspace/runtime-safety';
import { and, eq } from 'drizzle-orm';

import * as schema from '../db/schema';
import { type Message } from '../db/schema';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import { newChatJob } from '../testing/chat-job-rows';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatLoopService } from '../chats/chat-loop.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  createContextItemPart,
  isContextItemPart,
} from '../chats/context-item';
import { isModelChangePayload } from '../chats/context-item-producers';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { RunningReplyRepository } from '../chats/running-reply-repository';
import { type CompactionCapability } from '../compaction/compaction.service';
import { loadInstanceConfig } from '../instance-config/config-loader';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { MediaService } from '../media/media.service';
import { MemoryService } from '../memory/memory.service';
import { type ModelClient } from '../models/model-client';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { waitFor } from '../testing/support';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { type KnowledgeToolResolver } from '../tools/types';
import { reconstructDurableAssistant } from './assistant-transcript';
import { type RunDispatcher } from './run-dispatch.service';
import {
  RunExecutionService,
  type ChatSearchIndexer,
} from './run-execution.service';
import { runningReplyUsage } from './run-reply-finalizer';
import { type RunStreamResponder } from './run-stream-bridge';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

// The real SDK without a client, with the three entry points a Run touches
// observable: a provider failure must never reach Sentry carrying a credential.
vi.mock('@sentry/nestjs', async (importOriginal) => ({
  ...(await importOriginal<typeof Sentry>()),
  captureException: vi.fn(),
  setConversationId: vi.fn(),
  setUser: vi.fn(),
}));

const MODEL_ID = 'mock';
const USER_TEXT = 'answer the question';

const ITEM_TEXT =
  '<system-reminder producer="workspace" form="notice">attempt A item</system-reminder>';

/**
 * One canary per configured credential the five provider wires can echo. The
 * header canary is reachable only through the Chat Completions entry's
 * `Authorization` substitution, which proves header values are protected too.
 */
const CREDENTIAL_CANARY = {
  responses: 'RESPONSES-KEY-CANARY-0a1b',
  completions: 'COMPLETIONS-KEY-CANARY-2c3d',
  go: 'GO-KEY-CANARY-4e5f',
  messages: 'MESSAGES-KEY-CANARY-6a7b',
  codex: 'CODEX-KEY-CANARY-8c9d',
  header: 'HEADER-KEY-CANARY-1e2f',
} as const;

const WIRE_MODEL_ID = {
  responses: 'system:responses:test-model',
  completions: 'system:completions:test-model',
  go: 'system:go:test-model',
  messages: 'system:messages:test-model',
  codex: 'system:codex:test-model',
} as const;

const WIRE_USER_AGENT = 'llame/0.0.0-test';

/**
 * The five provider entries and the models that dispatch to them, as the
 * operator file spells them: every credential is a `{env:...}` token, so
 * `loadInstanceConfig` — the only producer of a nonempty credential set — is
 * what makes the factory's redaction active.
 */
function fiveWireConfigJson(): string {
  return JSON.stringify({
    providers: [
      {
        id: 'responses',
        type: 'openai-responses',
        key: '{env:RESPONSES_KEY}',
        baseUrl: 'https://responses.example.test/v1',
      },
      {
        id: 'completions',
        type: 'openai-completions',
        key: '{env:COMPLETIONS_KEY}',
        baseUrl: 'https://completions.example.test/v1',
        headers: { Authorization: 'Bearer {env:HEADER_KEY}' },
      },
      { id: 'go', type: 'opencode-go', key: '{env:GO_KEY}' },
      {
        id: 'messages',
        type: 'anthropic-messages',
        key: '{env:MESSAGES_KEY}',
        baseUrl: 'https://messages.example.test',
      },
      {
        id: 'codex',
        type: 'openai-codex',
        key: '{env:CODEX_KEY}',
        accountId: 'account-id',
      },
    ],
    models: [
      {
        id: WIRE_MODEL_ID.responses,
        provider: 'responses',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
      },
      {
        id: WIRE_MODEL_ID.completions,
        provider: 'completions',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
      },
      {
        id: WIRE_MODEL_ID.go,
        provider: 'go',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
      },
      {
        id: WIRE_MODEL_ID.messages,
        provider: 'messages',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
      },
      {
        id: WIRE_MODEL_ID.codex,
        provider: 'codex',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
      },
    ],
    defaults: { modelId: WIRE_MODEL_ID.responses },
  });
}

/** A JSON provider error envelope echoing `text`; 401 is never retried. */
function jsonErrorEnvelope(text: string): Response {
  return new Response(JSON.stringify({ error: { message: text } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

/** A plain-text provider error envelope echoing `text`; 401 is never retried. */
function textErrorEnvelope(text: string): Response {
  return new Response(text, { status: 401 });
}

const MODEL_ENTRY: SystemModelCatalogEntry = {
  id: MODEL_ID,
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'mock',
  providerModelId: MODEL_ID,
  billing: 'subscription',
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'model_override',
  referencesSkills: false,
  input: ['text'],
};

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

function answerChunks(text: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text },
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
}

const FAILURE_CHUNKS: Array<LanguageModelV3StreamPart> = [
  { type: 'stream-start', warnings: [] },
  { type: 'error', error: new Error('provider dropped the stream') },
];

function scriptedModel(
  chunks: Array<LanguageModelV3StreamPart>,
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
  });
}

function scriptedClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: MODEL_ID,
    provider: 'mock',
    contextWindowTokens: 128_000,
    streamText(input) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
        },
        onError: input.onError,
        onFinish: (event) =>
          input.onFinish?.({
            text: event.text,
            usage: event.usage,
            finishReason: event.finishReason,
            stepCount: event.steps.length,
          }),
      });
    },
  };
}

/** A user turn and its queued Run, ready for `executeRun`. */
type SeededTurn = {
  readonly chatId: string;
  readonly runId: string;
  readonly userMessage: { readonly id: string; readonly seq: number };
};

/**
 * Attempt A dispatched, streamed text, completed a tool call, stored an in-Run
 * item on its `running` reply with the reply's snapshot, streamed more text,
 * and died without settling.
 */
type DiedAttempt = SeededTurn & {
  readonly attemptId: string;
  readonly replyId: string;
};

type TerminalWriter = {
  readonly name: string;
  readonly runStatus: 'failed' | 'cancelled' | 'expired';
  readonly replyStatus: 'error' | 'aborted';
  /** Leave a dispatched host mutation open, as native recovery needs. */
  readonly openMutation?: boolean;
  /** The expiring send leaves the reindex to the Run it creates. */
  readonly reindexedByNextRun?: boolean;
  readonly settle: (died: DiedAttempt) => Promise<void>;
};

describeIfDb(
  'assistant reply from first dispatch to its terminal write',
  () => {
    let sql: Sql;
    let tenantDb: TenantDbService;
    let userId: string;
    let runExecution: RunExecutionService;
    let chatLoop: ChatLoopService;
    /** Provider clients built from the loader's own configuration. */
    let wireClients: ModelsService;
    let wireConfigDir: string;

    const jobState = vi.fn<RunDispatcher['jobState']>(() =>
      Promise.resolve('active'),
    );

    const reindexChat = vi.fn<ChatSearchIndexer['reindexChat']>(() =>
      Promise.resolve(),
    );

    const instanceConfig: InstanceConfigReader = {
      config: {
        ...BUILT_IN_DEFAULTS,
        models: [MODEL_ENTRY],
        runs: { ...BUILT_IN_DEFAULTS.runs, timeoutSeconds: 300 },
        tools: { ...BUILT_IN_DEFAULTS.tools, allowed: [] },
      },
    };

    beforeAll(async () => {
      sql = postgres(TEST_DB_URL!, {
        max: 4,
        ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      });
      tenantDb = new TenantDbService(drizzle(sql, { schema }));
      userId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Reply finalization', ${`reply-finalization-${userId}@test.com`})`;

      const models: ModelSelectionValidator = {
        validateModelSelection: () => MODEL_ENTRY,
        resolveEffortSelection: () => undefined,
      };

      const bridge: RunStreamResponder = {
        createUiMessageStreamResponse: () => new Response(),
      };

      const dispatcher: RunDispatcher = {
        dispatch: () => Promise.resolve(),
        jobState,
      };

      chatLoop = new ChatLoopService(
        tenantDb,
        models,
        instanceConfig,
        bridge,
        dispatcher,
        new MediaService(tenantDb),
      );

      // Every seeded turn fits the model's window, so a window summary request
      // would be a scenario this suite does not mean to exercise.
      const noopCompaction: CompactionCapability = {
        summarizeCheckpoint: (request) =>
          request.variant === 'window'
            ? Promise.reject(new Error('window summarization is not exercised'))
            : Promise.resolve(null),
      };

      runExecution = new RunExecutionService(
        tenantDb,
        noopCompaction,
        { maybeGenerateTitle: async () => {} },
        instanceConfig,
        { reindexChat },
        noopReindexDispatch(),
        knowledgeResolver,
        noopSkillCatalog(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
        compileTestPermissionPolicy(),
        models,
        new SystemPromptsService(),
        { resolvePromptUser: () => Promise.resolve(undefined) },
        { resolve: () => Promise.resolve([]) },
        { snapshotCandidates: () => [] },
        new MemoryService(tenantDb),
        new RecencyDigestService(tenantDb),
      );

      // The factory redacts against `configuredCredentials(config)`, a WeakMap
      // keyed by the exact object `loadInstanceConfig` returns — so the loaded
      // value reaches `ModelsService` by reference and `createClient` stays the
      // real factory (no override, no hand-built config fixture).
      wireConfigDir = mkdtempSync(path.join(tmpdir(), 'llame-five-wire-'));
      const wireConfigPath = path.join(wireConfigDir, 'llame.config.json');
      writeFileSync(wireConfigPath, fiveWireConfigJson());

      const wireConfig = loadInstanceConfig({
        LLAME_CONFIG_PATH: wireConfigPath,
        RESPONSES_KEY: CREDENTIAL_CANARY.responses,
        COMPLETIONS_KEY: CREDENTIAL_CANARY.completions,
        HEADER_KEY: CREDENTIAL_CANARY.header,
        GO_KEY: CREDENTIAL_CANARY.go,
        MESSAGES_KEY: CREDENTIAL_CANARY.messages,
        CODEX_KEY: CREDENTIAL_CANARY.codex,
      });

      wireClients = new ModelsService({
        config: wireConfig,
        productUserAgent: WIRE_USER_AGENT,
      });
    });

    afterEach(() => {
      jobState.mockReset();
      jobState.mockResolvedValue('active');
      reindexChat.mockClear();
    });

    afterAll(async () => {
      if (wireConfigDir)
        rmSync(wireConfigDir, { recursive: true, force: true });

      if (sql) {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        await sql.end();
      }
    });

    async function createChat(): Promise<string> {
      const chatId = crypto.randomUUID();
      await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Reply finalization',
        }),
      );

      return chatId;
    }

    /** A user message and its queued Run on `chatId`, on `modelId`. */
    async function seedTurn(
      chatId: string,
      modelId: string = MODEL_ID,
    ): Promise<SeededTurn> {
      return tenantDb.runAs(userId, async (tx) => {
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: USER_TEXT }],
        });

        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId,
        });

        return { chatId, runId: run.id, userMessage };
      });
    }

    async function seedDiedAttempt(options?: {
      openMutation?: boolean;
    }): Promise<DiedAttempt> {
      const turn = await seedTurn(await createChat());

      return tenantDb.runAs(userId, async (tx) => {
        const started = await new RunsRepository(tx).markStarted(
          turn.runId,
          userId,
        );

        const attemptId = started?.activeAttemptId;

        if (!attemptId) throw new Error('Attempt A did not claim the Run.');
        const events = new RunEventsRepository(tx);
        const replies = new RunningReplyRepository(tx);
        await events.append(turn.runId, 'run.started');
        await events.append(turn.runId, 'model.requested', {
          modelId: MODEL_ID,
          attemptId,
        });

        const reply = await replies.upsertRunningReply({
          chatId: turn.chatId,
          inReplyTo: turn.userMessage.id,
          usage: runningReplyUsage({
            runId: turn.runId,
            attemptId,
            modelId: MODEL_ID,
            effort: undefined,
            permissionMode: 'default',
          }),
          followUpAction: null,
        });

        if (!reply) throw new Error('Attempt A did not create its reply.');
        await events.append(turn.runId, 'model.delta', { text: 'A partial. ' });
        await events.append(turn.runId, 'tool.requested', {
          toolCallId: 'call-1',
          toolName: 'search_conversations',
          input: { query: 'budget' },
        });
        await events.append(turn.runId, 'tool.completed', {
          toolCallId: 'call-1',
          toolName: 'search_conversations',
          status: 'success',
          output: { status: 'success', matches: [] },
        });

        // The step after call-1 staged an item: its write stores the reply's
        // snapshot as the live collector held it, item last.
        const snapshot = reconstructDurableAssistant(
          await events.listByRunId(turn.runId, userId),
        ).collector.parts();

        const stored = await replies.updateRunningReplyParts({
          chatId: turn.chatId,
          inReplyTo: turn.userMessage.id,
          attemptId,
          parts: [
            ...snapshot,
            createContextItemPart({
              producer: 'workspace',
              form: 'notice',
              runId: turn.runId,
              payload: { marker: 'attempt-a' },
              text: ITEM_TEXT,
            }),
          ],
        });

        if (!stored) throw new Error('Attempt A did not store its item.');
        await events.append(turn.runId, 'model.delta', { text: 'A tail.' });

        if (options?.openMutation) {
          await events.append(turn.runId, 'tool.requested', {
            toolCallId: 'call-mutation',
            toolName: 'mcp__web__write',
            input: { value: 'external mutation' },
          });
          await events.append(turn.runId, 'native.attempt', {
            toolCallId: 'call-mutation',
            operation: 'mcp',
            path: 'mcp__web__write',
          });
        }

        return { ...turn, attemptId, replyId: reply.id };
      });
    }

    function execute(
      turn: SeededTurn,
      client: ModelClient,
      abortSignal?: AbortSignal,
    ) {
      return runExecution.executeRun({
        runId: turn.runId,
        chatId: turn.chatId,
        userId,
        userMessage: {
          id: turn.userMessage.id,
          seq: turn.userMessage.seq,
          parts: [{ type: 'text', text: USER_TEXT }],
        },
        client,
        ...(abortSignal !== undefined && { abortSignal }),
      });
    }

    /** The turn's reply row in any state, `running` included. */
    async function replyRow(turn: SeededTurn): Promise<Message | undefined> {
      const state = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findTurnState(
          turn.chatId,
          userId,
          turn.userMessage.id,
        ),
      );

      return state.assistantMessage;
    }

    function runEvents(runId: string) {
      return tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(runId, userId),
      );
    }

    function waitForEvent(runId: string, eventType: string) {
      return waitFor(
        async () =>
          (await runEvents(runId)).some(
            (event) => event.eventType === eventType,
          )
            ? true
            : undefined,
        5000,
        `${eventType} on Run ${runId}`,
      );
    }

    /** The attempt ids each `model.requested` of the Run names, in order. */
    async function dispatchedAttempts(runId: string): Promise<Array<unknown>> {
      return (await runEvents(runId)).flatMap((event) =>
        event.eventType === 'model.requested' && isRecord(event.payload)
          ? [event.payload['attemptId']]
          : [],
      );
    }

    /** The `fromModelId` of every model-switch item stored in the Chat. */
    async function switchedFrom(chatId: string): Promise<Array<string>> {
      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );

      return messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          isContextItemPart(part) && isModelChangePayload(part.data.payload)
            ? [part.data.payload.fromModelId]
            : [],
        ),
      );
    }

    it("resets the reply in the retry's own dispatch, and the retry's request carries none of the dead attempt's output or items", async () => {
      const died = await seedDiedAttempt();
      const replyAtRequest: Array<Message | undefined> = [];

      const model = new MockLanguageModelV3({
        doStream: async () => {
          replyAtRequest.push(await replyRow(died));

          return {
            stream: simulateReadableStream({
              chunks: answerChunks('B answer.'),
            }),
          };
        },
      });

      const result = await execute(died, scriptedClient(model));
      await result.consumeStream?.();
      await waitForEvent(died.runId, 'run.completed');

      const attempts = await dispatchedAttempts(died.runId);
      expect(attempts).toHaveLength(2);
      const [, retryAttemptId] = attempts;
      expect(retryAttemptId).not.toBe(died.attemptId);
      // The same row, emptied and `running` for the retry when its request left.
      expect(replyAtRequest).toEqual([
        expect.objectContaining({
          id: died.replyId,
          parts: [],
          usage: {
            status: 'running',
            complete: false,
            runId: died.runId,
            attemptId: retryAttemptId,
            modelId: MODEL_ID,
          },
        }),
      ]);
      const sent = JSON.stringify(model.doStreamCalls[0]?.prompt);
      expect(sent).not.toContain('A partial.');
      expect(sent).not.toContain('A tail.');
      expect(sent).not.toContain(ITEM_TEXT);

      const reply = await replyRow(died);
      expect(reply?.id).toBe(died.replyId);
      expect(reply?.parts).toEqual([
        expect.objectContaining({ type: 'text', text: 'B answer.' }),
      ]);
      expect(reply?.usage).toMatchObject({
        status: 'completed',
        runId: died.runId,
        attemptId: retryAttemptId,
        modelId: MODEL_ID,
      });
    });

    // background-jobs Scenario: A crash is found at the next message
    it('settles a job of a dead worker as lost at the Run claim, before the first model request', async () => {
      const chatId = await createChat();
      const turn = await seedTurn(chatId);
      const deadWorker = crypto.randomUUID();

      await sql`INSERT INTO worker_instances (id, last_seen_at)
        VALUES (${deadWorker}, now() - make_interval(secs => ${workerDeadAfterSeconds(BUILT_IN_DEFAULTS) + 5}))`;

      const crashed = await tenantDb.runAs(userId, (tx) =>
        new ChatJobsRepository(tx).insert(
          newChatJob({
            chatId,
            ownerUserId: userId,
            seq: 1,
            runId: turn.runId,
            workerInstanceId: deadWorker,
          }),
        ),
      );

      const statesAtRequest: Array<string | undefined> = [];

      const model = new MockLanguageModelV3({
        doStream: async () => {
          const job = await tenantDb.runAs(userId, (tx) =>
            new ChatJobsRepository(tx).findById(chatId, userId, crashed.id),
          );

          statesAtRequest.push(job?.state);

          return {
            stream: simulateReadableStream({ chunks: answerChunks('Done.') }),
          };
        },
      });

      try {
        const result = await execute(turn, scriptedClient(model));
        await result.consumeStream?.();
        await waitForEvent(turn.runId, 'run.completed');

        const settled = await tenantDb.runAs(userId, (tx) =>
          new ChatJobsRepository(tx).findById(chatId, userId, crashed.id),
        );

        const notices = await tenantDb.runAs(userId, (tx) =>
          tx
            .select({ id: schema.chatDeliveries.id })
            .from(schema.chatDeliveries)
            .where(
              and(
                eq(schema.chatDeliveries.chatId, chatId),
                eq(schema.chatDeliveries.ownerUserId, userId),
                eq(schema.chatDeliveries.producer, 'job'),
                eq(schema.chatDeliveries.senderRef, crashed.id),
              ),
            ),
        );

        expect(settled?.state).toBe('lost');
        expect(notices).toHaveLength(1);
        expect(statesAtRequest[0]).toBe('lost');
      } finally {
        await sql`DELETE FROM worker_instances WHERE id = ${deadWorker}`;
      }
    });

    const writers: ReadonlyArray<TerminalWriter> = [
      {
        name: 'retry exhaustion (dead letter)',
        runStatus: 'expired',
        replyStatus: 'aborted',
        settle: async (died) => {
          await runExecution.settleTerminalRun({
            runId: died.runId,
            userId,
            status: 'expired',
            runPayload: {
              status: 'expired',
              message: 'Run retries exhausted.',
            },
            error: { message: 'Run retries exhausted.' },
          });
        },
      },
      {
        name: 'cancellation before start',
        runStatus: 'cancelled',
        replyStatus: 'aborted',
        settle: async (died) => {
          await runExecution.settleTerminalRun({
            runId: died.runId,
            userId,
            status: 'cancelled',
            runPayload: { status: 'cancelled', message: 'Cancelled.' },
            error: { message: 'Cancelled.' },
          });
        },
      },
      {
        name: 'native-recovery outcome_unknown',
        runStatus: 'failed',
        replyStatus: 'error',
        openMutation: true,
        settle: (died) =>
          expect(
            execute(died, scriptedClient(scriptedModel(answerChunks('never')))),
          ).rejects.toThrow('no longer runnable'),
      },
      {
        name: 'pickup failure',
        runStatus: 'failed',
        replyStatus: 'error',
        settle: async (died) => {
          await runExecution.settleTerminalRun({
            runId: died.runId,
            userId,
            status: 'failed',
            runPayload: { status: 'failed', message: 'Run pickup failed.' },
            error: { message: 'Run pickup failed.' },
          });
        },
      },
      {
        name: 'an abort observed at claim',
        runStatus: 'cancelled',
        replyStatus: 'aborted',
        settle: (died) =>
          expect(
            execute(
              died,
              scriptedClient(scriptedModel(answerChunks('never'))),
              AbortSignal.abort(),
            ),
          ).rejects.toThrow('no longer runnable'),
      },
      {
        name: 'a cancel requested before the claim',
        runStatus: 'cancelled',
        replyStatus: 'aborted',
        settle: async (died) => {
          await tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).requestCancel(died.runId, userId),
          );
          await expect(
            execute(died, scriptedClient(scriptedModel(answerChunks('never')))),
          ).rejects.toThrow('no longer runnable');
        },
      },
      {
        name: 'admission expiry by a new message',
        runStatus: 'expired',
        replyStatus: 'aborted',
        reindexedByNextRun: true,
        settle: async (died) => {
          jobState.mockResolvedValue('failed');
          await chatLoop.createMessageStream({
            chatId: died.chatId,
            userId,
            modelId: MODEL_ID,
            message: {
              id: crypto.randomUUID(),
              parts: [{ type: 'text', text: 'a new message' }],
            },
          });
        },
      },
      {
        name: 'a later attempt that fails before its own dispatch',
        runStatus: 'failed',
        replyStatus: 'error',
        settle: async (died) => {
          const render = vi
            .spyOn(SystemPromptsService.prototype, 'render')
            .mockReturnValue({
              text: '',
              chatsDisclosure: { pinned: new Set(), recent: new Set() },
            });

          try {
            await expect(
              execute(
                died,
                scriptedClient(scriptedModel(answerChunks('never'))),
              ),
            ).rejects.toThrow('System prompt rendered empty.');
          } finally {
            render.mockRestore();
          }
        },
      },
    ];

    it.each(writers)(
      "settles the dead attempt's reply from its own events with the stored item in place: $name",
      async ({
        runStatus,
        replyStatus,
        openMutation,
        reindexedByNextRun,
        settle,
      }) => {
        const died = await seedDiedAttempt({ openMutation });
        // A sweep indexed the chat after its last activity, while the reply
        // was `running` and so hidden from the index.
        await sql`UPDATE chats SET updated_at = updated_at - interval '1 hour' WHERE id = ${died.chatId}`;
        const indexedAt = new Date(Date.now() - 30 * 60 * 1000);

        await settle(died);

        // The settled reply keeps its creation time, so only a chat newer than
        // that index lets the sweep find it; the settler also reindexes inline.
        const chat = await tenantDb.runAs(userId, (tx) =>
          new ChatsRepository(tx).findById(died.chatId, userId),
        );

        expect(chat?.updatedAt.getTime()).toBeGreaterThan(indexedAt.getTime());

        if (reindexedByNextRun) {
          expect(reindexChat).not.toHaveBeenCalled();
        } else {
          expect(reindexChat).toHaveBeenCalledWith(died.chatId, userId);
        }

        const run = await tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(died.runId, userId),
        );

        expect(run?.status).toBe(runStatus);
        expect(
          (await runEvents(died.runId)).filter(
            (event) => event.eventType === `run.${runStatus}`,
          ),
        ).toHaveLength(1);

        // Terminal, token-less, and attempt A's identity: no writer here
        // measured the attempt it settles.
        const reply = await replyRow(died);
        expect(reply?.id).toBe(died.replyId);
        expect(reply?.usage).toEqual({
          status: replyStatus,
          complete: false,
          runId: died.runId,
          attemptId: died.attemptId,
          modelId: MODEL_ID,
          billing: 'subscription',
          costUsd: null,
        });
        // A's output, rebuilt from its events, with its item after the tool
        // part of the step that triggered it.
        const parts = reply?.parts ?? [];

        const workspaceItemData: unknown = expect.objectContaining({
          producer: 'workspace',
          text: ITEM_TEXT,
        });

        expect(parts.slice(0, 4)).toEqual([
          expect.objectContaining({ type: 'text', text: 'A partial. ' }),
          expect.objectContaining({
            type: 'tool-search_conversations',
            toolCallId: 'call-1',
          }),
          expect.objectContaining({
            type: 'data-context',
            data: workspaceItemData,
          }),
          expect.objectContaining({ type: 'text', text: 'A tail.' }),
        ]);
        expect(parts.slice(4)).toEqual(
          openMutation
            ? [
                expect.objectContaining({
                  type: 'tool-mcp__web__write',
                  toolCallId: 'call-mutation',
                  state: 'output-error',
                }),
              ]
            : [],
        );

        // Settled, so history shows it.
        const history = await tenantDb.runAs(userId, (tx) =>
          new MessagesRepository(tx).findByChatId(died.chatId, userId),
        );

        expect(history.map(({ id }) => id)).toContain(died.replyId);
      },
    );

    describe('model-switch baseline', () => {
      it('announces a switch once when the Run that stored it failed without output', async () => {
        const chatId = await createChat();
        await tenantDb.runAs(userId, async (tx) => {
          const messages = new MessagesRepository(tx);

          const earlier = await messages.create({
            chatId,
            role: 'user',
            senderUserId: userId,
            parts: [{ type: 'text', text: 'earlier question' }],
          });

          await messages.create({
            chatId,
            role: 'assistant',
            inReplyTo: earlier.id,
            parts: [{ type: 'text', text: 'earlier answer' }],
            usage: { status: 'completed', modelId: 'source-model' },
          });
        });

        // The switching Run dispatches, which stores its switch item, and fails
        // on its first request with no output.
        const failing = await seedTurn(chatId);

        const failed = await execute(
          failing,
          scriptedClient(scriptedModel(FAILURE_CHUNKS)),
        );

        await failed.consumeStream?.();
        await waitForEvent(failing.runId, 'run.failed');
        expect(await switchedFrom(chatId)).toEqual(['source-model']);
        expect((await replyRow(failing))?.usage).toMatchObject({
          status: 'error',
          modelId: MODEL_ID,
        });

        const next = await seedTurn(chatId);

        const completed = await execute(
          next,
          scriptedClient(scriptedModel(answerChunks('Answered.'))),
        );

        await completed.consumeStream?.();
        await waitForEvent(next.runId, 'run.completed');

        expect(await switchedFrom(chatId)).toEqual(['source-model']);
      });
    });

    describe('configured credential redaction', () => {
      /** One wire's failure envelope and whether the factory itself must redact it. */
      type CredentialWire = {
        readonly wire: string;
        readonly modelId: string;
        readonly canary: string;
        /**
         * The Messages and Codex clients sanitize the failure before it reaches
         * the factory's wrapper, so they report no credential without needing
         * its marker; the other three wires rely on `withRedactedFailures`.
         */
        readonly redacts: boolean;
        readonly respond: () => Response;
      };

      const credentialWires: ReadonlyArray<CredentialWire> = [
        {
          wire: 'openai-responses',
          modelId: WIRE_MODEL_ID.responses,
          canary: CREDENTIAL_CANARY.responses,
          redacts: true,
          respond: () =>
            jsonErrorEnvelope(`echoed ${CREDENTIAL_CANARY.responses}`),
        },
        {
          wire: 'openai-completions',
          modelId: WIRE_MODEL_ID.completions,
          canary: CREDENTIAL_CANARY.completions,
          redacts: true,
          // Also proves the configured `Authorization` substitution is protected.
          respond: () =>
            jsonErrorEnvelope(
              `echoed ${CREDENTIAL_CANARY.completions} and ${CREDENTIAL_CANARY.header}`,
            ),
        },
        {
          wire: 'opencode-go',
          modelId: WIRE_MODEL_ID.go,
          canary: CREDENTIAL_CANARY.go,
          redacts: true,
          respond: () => jsonErrorEnvelope(`echoed ${CREDENTIAL_CANARY.go}`),
        },
        {
          wire: 'anthropic-messages',
          modelId: WIRE_MODEL_ID.messages,
          canary: CREDENTIAL_CANARY.messages,
          redacts: false,
          respond: () =>
            textErrorEnvelope(`echoed ${CREDENTIAL_CANARY.messages}`),
        },
        {
          wire: 'openai-codex',
          modelId: WIRE_MODEL_ID.codex,
          canary: CREDENTIAL_CANARY.codex,
          redacts: false,
          respond: () => textErrorEnvelope(`echoed ${CREDENTIAL_CANARY.codex}`),
        },
      ];

      it.each(credentialWires)(
        'keeps a configured credential out of the run, its stored events, the log, and Sentry on the $wire wire',
        async ({ modelId, canary, redacts, respond }) => {
          // Codex and Go capture `globalThis.fetch` when the client is built;
          // the other wires resolve it per request. Stub before `createClient`
          // so every transport is the stub and no request leaves the process.
          const fetchStub = vi.fn(() => Promise.resolve(respond()));
          vi.stubGlobal('fetch', fetchStub);

          const loggerError = vi
            .spyOn(Logger.prototype, 'error')
            .mockImplementation(() => undefined);

          vi.mocked(Sentry.captureException).mockClear();

          try {
            // The real `ModelsService` -> `createModelClient`, with only the
            // transport stubbed: no client override, no hand-built config.
            const client = wireClients.createClient(modelId);
            const chatId = await createChat();
            const failing = await seedTurn(chatId, modelId);

            const result = await execute(failing, client);
            await Promise.resolve(result.consumeStream?.()).catch(
              () => undefined,
            );
            await waitForEvent(failing.runId, 'run.failed');

            const failedRun = await tenantDb.runAs(userId, (tx) =>
              new RunsRepository(tx).findById(failing.runId, userId),
            );

            const events = await runEvents(failing.runId);

            const terminal = events.find(
              (event) => event.eventType === 'run.failed',
            );

            // A failure carrying its own error envelope, not a native/tool one.
            expect(failedRun?.status).toBe('failed');
            expect(terminal).toBeDefined();
            expect(fetchStub).toHaveBeenCalled();

            // `runs.error` and the stored terminal event, read back from Postgres.
            const runError = JSON.stringify(failedRun?.error);
            const terminalPayload = JSON.stringify(terminal?.payload);
            // Every other surface the same failure reaches: the run logger
            // (error stack) and the Sentry event argument.
            const logged = JSON.stringify(loggerError.mock.calls);

            const captured = JSON.stringify(
              vi
                .mocked(Sentry.captureException)
                .mock.calls.map(([error]) =>
                  error instanceof Error
                    ? `${error.message}\n${error.stack ?? ''}`
                    : String(error),
                ),
            );

            for (const surface of [
              runError,
              terminalPayload,
              logged,
              captured,
            ]) {
              expect(surface).not.toContain(canary);
              expect(surface).not.toContain(CREDENTIAL_CANARY.header);
            }

            if (redacts) {
              expect(runError).toContain('[REDACTED]');
              expect(terminalPayload).toContain('[REDACTED]');
            }

            // Non-vacuous: the failure actually reached both observation points.
            expect(loggerError).toHaveBeenCalled();
            expect(Sentry.captureException).toHaveBeenCalled();
          } finally {
            loggerError.mockRestore();
            vi.unstubAllGlobals();
          }
        },
      );
    });
  },
);
