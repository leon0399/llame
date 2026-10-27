/**
 * A Regenerate Run's execution (turn-actions D2, D7, D8, D9): its dispatch
 * replaces a completed reply and marks it revised, a failure before dispatch
 * leaves the old reply, a salvaged answer of its own is never reset, the turn's
 * notice is stored once after the items already there, and its own comparison
 * replaces the stored model-switch item.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart } from '../chats/context-item';
import { createTemporalItem } from '../chats/context-item-producers';
import { type MessagePart } from '../chats/context-builder';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { createRunForMessage } from '../chats/run-creation';
import { type CompactionCapability } from '../compaction/compaction.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { MemoryService } from '../memory/memory.service';
import { type ModelClient } from '../models/model-client';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type ModelSelectionValidator } from '../models/models.service';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { getRegisteredToolIds } from '../tools/registry';
import { type KnowledgeToolResolver } from '../tools/types';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const MODEL_A = 'mock-a';
const MODEL_B = 'mock-b';
const MODEL_C = 'mock-c';
const USER_TEXT = 'Do the work';
const OLD_TEXT = 'the old answer';

function catalogEntry(id: string): SystemModelCatalogEntry {
  return {
    id,
    source: 'system',
    contextWindowTokens: 128_000,
    provider: 'mock',
    providerModelId: id,
    billing: 'subscription',
    systemPromptTemplate: 'Test prompt',
    systemPromptSource: 'model_override',
    referencesSkills: false,
    input: ['text'],
  };
}

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

function scriptedModel(
  chunks: Array<LanguageModelV3StreamPart>,
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({ stream: simulateReadableStream({ chunks }) }),
  });
}

/** A client over a scripted model, recording every request the Run sends. */
function scriptedClient(
  model: MockLanguageModelV3,
  modelId: string,
  options: {
    requests?: Array<Parameters<ModelClient['streamText']>[0]>;
    contextWindowTokens?: number;
  } = {},
): ModelClient {
  return {
    model: modelId,
    provider: 'mock',
    contextWindowTokens: options.contextWindowTokens ?? 128_000,
    streamText(input) {
      options.requests?.push(input);
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

/** The model-switch item an earlier Run of the turn stored, A to B. */
function storedSwitchItem(runId: string): MessagePart {
  return {
    type: 'data-context',
    data: {
      v: 1,
      producer: 'effective-context-change',
      form: 'notice',
      runId,
      payload: { cause: 'model', fromModelId: MODEL_A, toModelId: MODEL_B },
      text: '<system-reminder producer="effective-context-change" form="notice">\nInserted by llame; not written by the user.\nThe active model changed from mock-a to mock-b before this message.\n</system-reminder>',
    },
  };
}

describeIfDb('a Regenerate Run', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let userId: string;
  let runExecution: RunExecutionService;

  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      models: [
        catalogEntry(MODEL_A),
        catalogEntry(MODEL_B),
        catalogEntry(MODEL_C),
      ],
      runs: { ...BUILT_IN_DEFAULTS.runs, timeoutSeconds: 300 },
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        allowed: ['search_conversations'],
      },
    },
  };

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 4,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Regenerate run', ${`regenerate-run-${userId}@test.com`})`;

    const models: ModelSelectionValidator = {
      validateModelSelection: (modelId) => {
        const entry = [MODEL_A, MODEL_B, MODEL_C].find(
          (known) => known === modelId,
        );
        if (entry === undefined) throw new Error(`Unknown model ${modelId}`);
        return catalogEntry(entry);
      },
      resolveEffortSelection: () => undefined,
    };
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
      { reindexChat: () => Promise.resolve() },
      noopReindexDispatch(),
      knowledgeResolver,
      noopSkillCatalog(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      compileTestPermissionPolicy(getRegisteredToolIds()),
      models,
      new SystemPromptsService(),
      { resolvePromptUser: () => Promise.resolve(undefined) },
      { resolve: () => Promise.resolve([]) },
      { snapshotCandidates: () => [] },
      new MemoryService(tenantDb),
      new RecencyDigestService(tenantDb),
    );
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  type RegeneratedTurn = {
    chatId: string;
    messageId: string;
    runId: string;
    seq: number;
    sourceRunId: string;
    replyId: string;
  };

  /**
   * A turn whose completed reply a Regenerate Run replaces, plus the Run
   * admission would create for it — the same transaction path a follow-up
   * request uses, so the event log is real.
   */
  async function seedRegeneratedTurn(options?: {
    /** The model the replaced reply recorded, when a prior turn has one. */
    previousReplyModelId?: string;
    /** The model the Regenerate request names. */
    modelId?: string;
    /** The replaced reply's parts. */
    replyParts?: Array<unknown>;
    /** Items an earlier Run of this turn stored on the trigger. */
    storedItems?: (sourceRunId: string) => Array<MessagePart>;
    /** Whether admission decided the notice is owed. */
    notice?: boolean;
    /** Whether this Run already dispatched once (a retry). */
    dispatched?: boolean;
    /** Whether the replaced reply is the Run's own salvaged answer. */
    replyOfThisRun?: boolean;
  }): Promise<RegeneratedTurn> {
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    return tenantDb.runAs(userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await chatsRepo.createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Regenerate Run',
      });
      if (options?.previousReplyModelId !== undefined) {
        const earlier = await messagesRepo.create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'An earlier turn' }],
        });
        await messagesRepo.createAssistantReplyIfAbsent({
          chatId,
          inReplyTo: earlier.id,
          parts: [{ type: 'text', text: 'An earlier answer' }],
          usage: {
            status: 'completed',
            complete: true,
            runId: crypto.randomUUID(),
            modelId: options.previousReplyModelId,
          },
        });
        const previousRun = await runsRepo.create({
          chatId,
          messageId: earlier.id,
          userId,
          modelId: options.previousReplyModelId,
        });
        await runsRepo.markFinished(previousRun.id, userId, 'completed');
        await tx
          .update(schema.runs)
          .set({ turnToolAvailability: [] })
          .where(eq(schema.runs.id, previousRun.id));
      }
      const sourceRunId = crypto.randomUUID();
      const trigger = await messagesRepo.create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [
          { type: 'text', text: USER_TEXT },
          ...(options?.storedItems?.(sourceRunId) ?? []),
        ],
      });
      const sourceRun = await runsRepo.create({
        id: sourceRunId,
        chatId,
        messageId,
        userId,
        modelId: options?.previousReplyModelId ?? MODEL_A,
      });
      await tx
        .update(schema.runs)
        .set({ turnToolAvailability: [] })
        .where(eq(schema.runs.id, sourceRun.id));
      await runsRepo.markFinished(sourceRun.id, userId, 'completed');
      const { run } = await createRunForMessage(
        tx,
        {
          userId,
          chatId,
          modelId: options?.modelId ?? MODEL_C,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: crypto.randomUUID(),
          followUp: {
            action: 'regenerate',
            sourceRunId: sourceRun.id,
            notice: options?.notice === true,
            replacesUsage: true,
          },
        },
        trigger,
      );
      if (options?.dispatched === true) {
        // A retry: this Run's first dispatch already recorded its availability
        // and stored its items.
        await tx
          .update(schema.runs)
          .set({ turnToolAvailability: [] })
          .where(eq(schema.runs.id, run.id));
      }
      // A reply of this Run is the salvaged answer it already stored: the
      // dispatch must refuse to reset it (turn-actions D7).
      const reply = await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: messageId,
        parts:
          options?.replyOfThisRun === true
            ? [{ type: 'text', text: 'salvaged answer' }]
            : (options?.replyParts ?? [{ type: 'text', text: OLD_TEXT }]),
        usage:
          options?.replyOfThisRun === true
            ? {
                status: 'completed',
                complete: false,
                runId: run.id,
                modelId: options?.modelId ?? MODEL_C,
              }
            : {
                status: 'completed',
                complete: true,
                runId: sourceRun.id,
                modelId: options?.previousReplyModelId ?? MODEL_A,
              },
      });
      if (reply === undefined) {
        throw new Error('the seeded turn left no reply');
      }
      return {
        chatId,
        messageId,
        runId: run.id,
        seq: trigger.seq,
        sourceRunId: sourceRun.id,
        replyId: reply.id,
      };
    });
  }

  async function execute(
    turn: RegeneratedTurn,
    client: ModelClient,
  ): Promise<void> {
    const result = await runExecution.executeRun({
      runId: turn.runId,
      chatId: turn.chatId,
      userId,
      userMessage: {
        id: turn.messageId,
        seq: turn.seq,
        parts: [{ type: 'text', text: USER_TEXT }],
      },
      client,
      followUpAction: 'regenerate',
    });
    await (result.consumeStream?.() ?? result.text);
  }

  const runOf = (runId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  const eventsOfRun = (runId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );

  const replyOf = (turn: RegeneratedTurn): Promise<Message | undefined> =>
    tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findById(turn.chatId, userId, turn.replyId),
    );

  const triggerPartsOf = (turn: RegeneratedTurn) =>
    tenantDb.runAs(userId, async (tx) => {
      const turnState = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        turn.messageId,
      );
      return turnState.userMessage?.parts ?? [];
    });

  const contextItemsOf = async (turn: RegeneratedTurn) =>
    (await triggerPartsOf(turn)).filter(isContextItemPart);

  it('replaces a completed reply and finalizes the new answer alone', async () => {
    const turn = await seedRegeneratedTurn({
      replyParts: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: OLD_TEXT },
        {
          type: 'tool-read',
          toolCallId: 'call-old',
          state: 'output-available',
          input: { path: '/tmp/old.txt' },
          output: { status: 'success', text: 'old file' },
          outcome: 'success',
          classification: 'read_only',
        },
      ],
    });
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('the new answer')), MODEL_C, {
        requests,
      }),
    );

    // The request starts from the history through the trigger: no part of the
    // old reply reaches it.
    expect(requests).toHaveLength(1);
    const sent = requests[0]?.messages ?? [];
    expect(sent.filter(({ role }) => role === 'user')).toHaveLength(1);
    expect(sent.map(({ role }) => role)).toEqual(['user']);
    expect(JSON.stringify(sent)).not.toContain(OLD_TEXT);

    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([{ type: 'text', text: 'the new answer' }]);
    expect(reply?.usage).toMatchObject({
      status: 'completed',
      runId: turn.runId,
      modelId: MODEL_C,
      complete: false,
    });
    expect(reply?.revisedAt).not.toBeNull();
    expect((await runOf(turn.runId))?.status).toBe('completed');
    // The old answer stays only in its Run's event log.
    const oldEvents = await eventsOfRun(turn.sourceRunId);
    expect(JSON.stringify(oldEvents)).not.toContain(OLD_TEXT);
  });

  it('leaves the old reply untouched when it fails before dispatch', async () => {
    const turn = await seedRegeneratedTurn();
    const before = await replyOf(turn);
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    // A window the trigger cannot fit, with nothing to summarize, fails the
    // Run during preparation.
    await expect(
      execute(
        turn,
        scriptedClient(scriptedModel(answerChunks('never sent')), MODEL_C, {
          requests,
          contextWindowTokens: 8,
        }),
      ),
    ).rejects.toThrow(/context window/u);

    expect(requests).toHaveLength(0);
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual(before?.parts);
    expect(reply?.usage).toEqual(before?.usage);
    // The old reply was never replaced, so it stays eligible evidence.
    expect(reply?.revisedAt).toBeNull();
  });

  it('never resets the answer its own earlier attempt salvaged', async () => {
    const turn = await seedRegeneratedTurn({
      dispatched: true,
      replyOfThisRun: true,
    });

    // The dispatch refuses to replace a completed reply that names this Run,
    // so the attempt ends without dispatching and the Run settles completed.
    await expect(
      execute(turn, scriptedClient(scriptedModel(answerChunks('x')), MODEL_C)),
    ).rejects.toThrow(/no longer runnable/u);

    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([{ type: 'text', text: 'salvaged answer' }]);
    expect(reply?.revisedAt).toBeNull();
    expect((await runOf(turn.runId))?.status).toBe('completed');
  });

  it('stores the notice once, after the items the turn already holds', async () => {
    const turn = await seedRegeneratedTurn({
      notice: true,
      storedItems: (sourceRunId) => [
        createTemporalItem({
          runId: sourceRunId,
          instant: new Date('2026-10-27T10:00:00.000Z'),
          timeZone: 'UTC',
        }),
      ],
    });
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_C, {
        requests,
      }),
    );

    const items = await contextItemsOf(turn);
    const producers = items.map(({ data }) => data.producer);
    expect(producers.filter((p) => p === 'regenerate')).toHaveLength(1);
    expect(producers.filter((p) => p === 'temporal')).toHaveLength(1);
    // The notice follows the stored item and precedes the user's text.
    expect(producers.indexOf('regenerate')).toBeGreaterThan(
      producers.indexOf('temporal'),
    );
    const notice = items.find(({ data }) => data.producer === 'regenerate');
    expect(notice?.data.text).toContain(
      'An earlier attempt at this turn was discarded',
    );
    // The model reads it inside the triggering user message.
    const trigger = (requests[0]?.messages ?? []).filter(
      ({ role }) => role === 'user',
    );
    expect(JSON.stringify(trigger)).toContain(
      'An earlier attempt at this turn was discarded',
    );
  });

  it('carries the notice in a tool-less Regenerate request', async () => {
    const turn = await seedRegeneratedTurn({ notice: true });
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_C, {
        requests,
      }),
    );

    const userMessages = (requests[0]?.messages ?? []).filter(
      ({ role }) => role === 'user',
    );
    expect(userMessages).toHaveLength(1);
    expect(JSON.stringify(userMessages[0])).toContain(
      'An earlier attempt at this turn was discarded',
    );
    expect(
      (await contextItemsOf(turn)).filter(
        ({ data }) => data.producer === 'regenerate',
      ),
    ).toHaveLength(1);
  });

  it('replaces a stored model-switch item with its own comparison', async () => {
    // The first Run of this turn stored A to B; the Regenerate asks for C.
    const turn = await seedRegeneratedTurn({
      previousReplyModelId: MODEL_A,
      modelId: MODEL_C,
      storedItems: (sourceRunId) => [storedSwitchItem(sourceRunId)],
    });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_C),
    );

    const switches = (await contextItemsOf(turn)).filter(
      ({ data }) => data.producer === 'effective-context-change',
    );
    expect(switches).toHaveLength(1);
    expect(switches[0]?.data.payload).toMatchObject({
      cause: 'model',
      fromModelId: MODEL_A,
      toModelId: MODEL_C,
    });
  });

  it('stores no switch item when the Regenerate returns to the prior model', async () => {
    // The stored item says A to B; the request names A, the prior reply's model.
    const turn = await seedRegeneratedTurn({
      previousReplyModelId: MODEL_A,
      modelId: MODEL_A,
      storedItems: (sourceRunId) => [storedSwitchItem(sourceRunId)],
    });
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_A, {
        requests,
      }),
    );

    expect(
      (await contextItemsOf(turn)).filter(
        ({ data }) => data.producer === 'effective-context-change',
      ),
    ).toEqual([]);
    // The request carries no switch item either.
    expect(JSON.stringify(requests[0]?.messages ?? [])).not.toContain(
      'effective-context-change',
    );
  });

  it('keeps the switch item its first dispatch stored on a retry', async () => {
    const turn = await seedRegeneratedTurn({
      previousReplyModelId: MODEL_A,
      modelId: MODEL_C,
      dispatched: true,
      storedItems: (sourceRunId) => [storedSwitchItem(sourceRunId)],
    });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_C),
    );

    const switches = (await contextItemsOf(turn)).filter(
      ({ data }) => data.producer === 'effective-context-change',
    );
    // The stored A-to-B item stays: only a first dispatch compares again.
    expect(switches).toHaveLength(1);
    expect(switches[0]?.data.payload).toMatchObject({
      fromModelId: MODEL_A,
      toModelId: MODEL_B,
    });
  });
});
