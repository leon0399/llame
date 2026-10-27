/**
 * A Continue Run's execution (turn-actions D1, D5, D6, D8, D11): the request it
 * sends resumes the kept steps of a failed reply, no kept call executes again,
 * the reply finalizes as kept parts then new parts, a failure before dispatch
 * changes nothing, kept parts that do not fit fail as context-incompatible, the
 * turn's rail keeps its stored items, and the usage names the Continue Run.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText, type ModelMessage, type ToolResultPart } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import * as schema from '../db/schema';
import { type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart } from '../chats/context-item';
import { createTemporalItem } from '../chats/context-item-producers';
import { type MessagePart } from '../chats/context-builder';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { createRunForMessage } from '../chats/run-creation';
import type { ToolResult } from '../tools/types';

import {
  continuedRecords,
  type ContinuedEvent,
} from '../chats/continue-projection';
import { RunningReplyRepository } from '../chats/running-reply-repository';
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

const MODEL_ID = 'mock';
const OTHER_MODEL_ID = 'mock-previous';
const USER_TEXT = 'Continue the work';
const KEPT_TEXT = 'reading the file';
const KEPT_RESULT = 'file body';
const CALL_ID = 'call-kept';

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

/** A settled `read` call, as the failed reply stored it. */
const keptParts: Array<MessagePart> = [
  { type: 'reasoning', text: 'I should read the file first' },
  { type: 'text', text: KEPT_TEXT },
  {
    type: 'tool-read',
    toolCallId: CALL_ID,
    state: 'output-available',
    input: { path: '/tmp/file.txt' },
    output: { status: 'success', path: '/tmp/file.txt', text: KEPT_RESULT },
    outcome: 'success',
  },
];

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

function failureChunks(afterText: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: afterText },
    { type: 'text-end', id: 'text' },
    { type: 'error', error: new Error('provider dropped the stream') },
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

/**
 * A client over a scripted model, recording every request the Run sends so a
 * test can read what reached the model.
 */
function scriptedClient(
  model: MockLanguageModelV3,
  options: {
    requests?: Array<Parameters<ModelClient['streamText']>[0]>;
    contextWindowTokens?: number;
  } = {},
): ModelClient {
  return {
    model: MODEL_ID,
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

describeIfDb('a Continue Run', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let userId: string;
  let runExecution: RunExecutionService;

  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      models: [MODEL_ENTRY],
      runs: { ...BUILT_IN_DEFAULTS.runs, timeoutSeconds: 300 },
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        // One always-available tool, so this turn's catalog has a state the
        // earlier Run's record can differ from (turn-actions D8).
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
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Continue run', ${`continue-run-${userId}@test.com`})`;

    const models: ModelSelectionValidator = {
      validateModelSelection: () => MODEL_ENTRY,
      resolveEffortSelection: () => undefined,
    };
    // Every seeded turn fits the model's window unless a test narrows it, so a
    // window summary request would be a scenario this suite does not exercise.
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

  type ContinuedTurn = {
    chatId: string;
    messageId: string;
    runId: string;
    seq: number;
  };

  /**
   * The source Run's own event log — the results it sent, its chain, and the
   * extra step it made — and the records the Continue Run stores for the kept
   * calls, derived from it.
   */
  async function seedSourceRecords(
    tx: Parameters<Parameters<TenantDbService['runAs']>[1]>[0],
    sourceRunId: string,
    sourceParts: ReadonlyArray<unknown>,
    options: Parameters<typeof seedContinuedTurn>[0],
  ) {
    const sourceEvents = new RunEventsRepository(tx);
    const sourceRecorded: Array<ContinuedEvent> = [];
    const inherited = options?.inheritedResults ?? {};
    for (const part of sourceParts) {
      const record = keptResultOf(part);
      // An inherited call's result is not this Run's completion to record.
      if (record === undefined || record.toolCallId in inherited) continue;
      const payload = {
        toolCallId: record.toolCallId,
        toolName: 'read',
        status: 'success',
        output: record.output,
      };
      await sourceEvents.append(sourceRunId, 'tool.completed', payload);
      sourceRecorded.push({ eventType: 'tool.completed', payload });
    }
    if (options?.chainedOwnCall === true) {
      const payload = {
        toolCallId: 'call-own',
        toolName: 'read',
        input: { path: '/tmp/second.txt' },
        stepNumber: 0,
      };
      await sourceEvents.append(sourceRunId, 'tool.requested', payload);
      sourceRecorded.push({ eventType: 'tool.requested', payload });
    }
    const chained = options?.sourceContinued === true;
    if (chained) {
      await sourceEvents.append(sourceRunId, 'run.continued', {
        sourceRunId: crypto.randomUUID(),
        parts: [],
        steps: { [CALL_ID]: 0 },
        results: options?.inheritedResults ?? {},
      });
    }
    // SAFETY: the seeded reply parts are stored UI parts, and the projection
    // re-validates every part it reads.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const keptParts = sourceParts as ReadonlyArray<MessagePart>;
    return continuedRecords({
      keptParts,
      ...(chained && {
        sourceContinued: {
          parts: [],
          stepNumbers: new Map([[CALL_ID, 0]]),
          // The results that Run inherited, as its `run.continued` holds them.
          results: new Map<string, ToolResult>(Object.entries(inherited)),
        },
      }),
      sourceEvents: sourceRecorded,
    });
  }

  /**
   * A turn whose source Run failed after one settled step, plus the Continue
   * Run admission would create for it — the same transaction path a follow-up
   * request uses, so the event log is real.
   */
  async function seedContinuedTurn(options?: {
    /** The source Run's recorded availability, which marks it dispatched. */
    sourceAvailability?: Array<{
      id: string;
      state: 'available' | 'unavailable';
    }>;
    replyParts?: Array<unknown>;
    previousReplyModelId?: string;
    temporalItem?: boolean;
    promptImportsItem?: boolean;
    /** One skill an earlier Run already activated on this turn. */
    skillActivationItem?: string;
    /** Whether the source Run was itself a Continue Run. */
    sourceContinued?: boolean;
    /** Whether the source Run made a second read of its own. */
    chainedOwnCall?: boolean;
    /**
     * Results the source Run inherited from the Run it continued: they live
     * only in its `run.continued`, never in its own completion events.
     */
    inheritedResults?: Record<string, ToolResult>;
  }): Promise<ContinuedTurn> {
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    return tenantDb.runAs(userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await chatsRepo.createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Continue Run',
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
        // A dispatched predecessor Run with its own record, so a baseline
        // lookup that ignored this message's earlier Run would read `[]` and
        // find no change (turn-actions D8).
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
      // The items an earlier Run of this turn stored on its trigger, which the
      // Continue Run must keep rather than author again (turn-actions D8). The
      // source Run's id is generated here because its items name it and the
      // trigger has to exist before the Run row can reference it.
      const sourceRunId = crypto.randomUUID();
      const storedItems: Array<MessagePart> = [];
      if (options?.temporalItem === true) {
        storedItems.push(
          createTemporalItem({
            runId: sourceRunId,
            instant: new Date('2026-10-27T10:00:00.000Z'),
            timeZone: 'UTC',
          }),
        );
      }
      if (options?.promptImportsItem === true) {
        storedItems.push({
          type: 'data-context',
          data: {
            v: 1,
            producer: 'prompt-imports',
            runId: sourceRunId,
            payload: { entries: [] },
            text: 'stored import',
          },
        });
      }
      if (options?.skillActivationItem !== undefined) {
        storedItems.push({
          type: 'data-context',
          data: {
            v: 1,
            producer: 'skill-activation',
            runId: sourceRunId,
            payload: { kind: 'activation', skill: options.skillActivationItem },
            text: `$${options.skillActivationItem}`,
          },
        });
      }
      const text =
        options?.skillActivationItem === undefined
          ? USER_TEXT
          : `${USER_TEXT} $${options.skillActivationItem}`;
      const trigger = await messagesRepo.create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text }, ...storedItems],
      });
      const sourceRun = await runsRepo.create({
        id: sourceRunId,
        chatId,
        messageId,
        userId,
        modelId: MODEL_ID,
      });
      const sourceParts: Array<unknown> = options?.replyParts ?? keptParts;
      if (options?.sourceAvailability !== undefined) {
        await tx
          .update(schema.runs)
          .set({ turnToolAvailability: options.sourceAvailability })
          .where(eq(schema.runs.id, sourceRun.id));
      }
      await runsRepo.markFinished(sourceRun.id, userId, 'failed', {
        error: { message: 'the model dropped the stream' },
      });
      await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: messageId,
        parts: sourceParts,
        usage: {
          status: 'error',
          complete: false,
          runId: sourceRun.id,
          modelId: MODEL_ID,
          attemptId: crypto.randomUUID(),
        },
      });
      const records = await seedSourceRecords(
        tx,
        sourceRun.id,
        sourceParts,
        options,
      );
      const { run } = await createRunForMessage(
        tx,
        {
          userId,
          chatId,
          modelId: MODEL_ID,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: crypto.randomUUID(),
          followUp: {
            action: 'continue',
            sourceRunId: sourceRun.id,
            keptParts: sourceParts,
            keptStepNumbers: records.steps,
            keptResults: records.results,
            replacesUsage: true,
          },
        },
        trigger,
      );
      return { chatId, messageId, runId: run.id, seq: trigger.seq };
    });
  }

  function userMessageOf(turn: ContinuedTurn) {
    return {
      id: turn.messageId,
      seq: turn.seq,
      parts: [{ type: 'text', text: USER_TEXT }],
    };
  }

  async function execute(
    turn: ContinuedTurn,
    client: ModelClient,
  ): Promise<void> {
    const result = await runExecution.executeRun({
      runId: turn.runId,
      chatId: turn.chatId,
      userId,
      userMessage: userMessageOf(turn),
      client,
      followUpAction: 'continue',
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

  const replyOf = (turn: ContinuedTurn): Promise<Message | undefined> =>
    tenantDb.runAs(userId, async (tx) => {
      const turnState = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        turn.messageId,
      );
      return turnState.assistantMessage;
    });

  const contextItemsOf = (turn: ContinuedTurn) =>
    tenantDb.runAs(userId, async (tx) => {
      const turnState = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        turn.messageId,
      );
      return (turnState.userMessage?.parts ?? []).filter(isContextItemPart);
    });

  it('sends the kept steps, executes no kept call, and finalizes kept then new parts', async () => {
    const turn = await seedContinuedTurn();
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), { requests }),
    );

    // One request: the history through the trigger, then the kept step.
    expect(requests).toHaveLength(1);
    const sent = requests[0]?.messages ?? [];
    // The trigger appears once, and the kept step follows it directly.
    const userMessages = sent.filter(({ role }) => role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toContainEqual({
      type: 'text',
      text: USER_TEXT,
    });
    expect(sent.at(-3)).toBe(userMessages[0]);
    // The request ends with the kept step: one assistant turn with its
    // reasoning, its text, and its call, then one turn with its result.
    expect(sent.slice(-2).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
    ]);
    expect(sent.at(-2)).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'I should read the file first' },
        { type: 'text', text: KEPT_TEXT },
        expect.objectContaining({ type: 'tool-call', toolCallId: CALL_ID }),
      ],
    });
    expect(sent.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        expect.objectContaining({
          type: 'tool-result',
          toolCallId: CALL_ID,
          toolName: 'read',
        }),
      ],
    });
    // The kept result reaches the model in full, as the live loop sent it.
    expect(JSON.stringify(sent.at(-1))).toContain(KEPT_RESULT);

    // No kept call ran again: the Continue Run's log holds no tool event.
    const events = await eventsOfRun(turn.runId);
    expect(events.map(({ eventType }) => eventType)).not.toContain(
      'tool.requested',
    );

    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      ...keptParts,
      { type: 'text', text: 'done' },
    ]);
    expect(reply?.usage).toMatchObject({
      status: 'completed',
      runId: turn.runId,
      modelId: MODEL_ID,
      complete: false,
    });
    expect((await runOf(turn.runId))?.status).toBe('completed');
  });

  it('keeps the kept parts when it fails after a new part', async () => {
    const turn = await seedContinuedTurn();

    await execute(
      turn,
      scriptedClient(scriptedModel(failureChunks('partial'))),
    );

    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      ...keptParts,
      { type: 'text', text: 'partial' },
    ]);
    expect(reply?.usage).toMatchObject({ status: 'error', runId: turn.runId });
    expect((await runOf(turn.runId))?.status).toBe('failed');
  });

  it('fails before dispatch when the kept parts do not fit, and changes nothing', async () => {
    const turn = await seedContinuedTurn();
    const before = await replyOf(turn);
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    // A window the trigger plus the kept parts cannot fit after compaction
    // leaves nothing to summarize, so preparation fails the Run.
    await expect(
      execute(
        turn,
        scriptedClient(scriptedModel(answerChunks('done')), {
          requests,
          contextWindowTokens: 8,
        }),
      ),
    ).rejects.toThrow(/context window/u);

    expect(requests).toHaveLength(0);
    const events = await eventsOfRun(turn.runId);
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'run.created',
      'run.continued',
      'run.started',
      'run.failed',
    ]);
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual(before?.parts);
    expect(reply?.usage).toEqual(before?.usage);
  });

  it('keeps one temporal item, appends an availability change, and adds no model-switch item', async () => {
    const turn = await seedContinuedTurn({
      // The earlier Run of this turn recorded `read` as available; the
      // preceding turn recorded nothing available, so a baseline that read
      // that turn would find no change at all.
      sourceAvailability: [{ id: 'read', state: 'available' }],
      temporalItem: true,
      previousReplyModelId: OTHER_MODEL_ID,
    });

    await execute(turn, scriptedClient(scriptedModel(answerChunks('done'))));

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'temporal'),
    ).toHaveLength(1);
    expect(
      items.filter((item) => item.data.producer === 'model-switch'),
    ).toHaveLength(0);
    // The availability comparison runs against the earlier Run of this turn,
    // whose record named `read`, so its removal is appended after the items the
    // turn already stored.
    const availability = items.filter(
      (item) => item.data.producer === 'tool-availability',
    );
    expect(availability).toHaveLength(1);
    expect(items.at(-1)).toBe(availability[0]);
    expect(availability[0]?.data.runId).toBe(turn.runId);
  });

  it('reuses the stored skill activation and stores no second one', async () => {
    // The turn named a skill an earlier Run already activated; the Continue
    // Run carries that item and authors no second one (turn-actions D8).
    const turn = await seedContinuedTurn({ skillActivationItem: 'demo' });

    await execute(turn, scriptedClient(scriptedModel(answerChunks('done'))));

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'skill-activation'),
    ).toHaveLength(1);
    expect(
      (await eventsOfRun(turn.runId)).filter(
        ({ eventType }) => eventType === 'tool.requested',
      ),
    ).toEqual([]);
  });

  it("keeps a chained Continue's earlier steps separate from its own", async () => {
    // The source Run was itself continued: it kept one step of its own source
    // (its own events number its step 0, and so does the kept one) and made a
    // second. The new Continue must send both as separate steps.
    const inherited = {
      status: 'success' as const,
      kind: 'text' as const,
      path: '/tmp/file.txt',
      text: 'inherited body',
    };
    const turn = await seedContinuedTurn({
      sourceContinued: true,
      chainedOwnCall: true,
      inheritedResults: { [CALL_ID]: inherited },
      replyParts: [
        keptParts[0],
        keptParts[1],
        keptParts[2],
        {
          type: 'tool-read',
          toolCallId: 'call-own',
          state: 'output-available',
          input: { path: '/tmp/second.txt' },
          output: { status: 'success', text: 'second file' },
          outcome: 'success',
        },
      ],
    });
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), { requests }),
    );

    const sent = requests[0]?.messages ?? [];
    expect(sent.slice(-4).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    // Both kept calls arrive, each in its own assistant turn.
    const callIds = sent.flatMap(({ role, content }) =>
      role === 'assistant' && Array.isArray(content)
        ? content.flatMap((part) =>
            part.type === 'tool-call' ? [part.toolCallId] : [],
          )
        : [],
    );
    expect(callIds).toEqual([CALL_ID, 'call-own']);
    // The inherited call's result lives only in the source Run's
    // `run.continued`, and it replays exactly as the live loop sent it rather
    // than through the later-turn renderer.
    const inheritedResult = toolResultOf(sent, CALL_ID);
    expect(inheritedResult).toMatchObject({
      type: 'tool-result',
      toolName: 'read',
      output: { type: 'text' },
    });
    // The live loop sent a native result as its serialized form, with no
    // untrusted frame and no budget.
    const serialized = inheritedResult?.output;
    expect(
      serialized?.type === 'text' ? JSON.parse(serialized.value) : undefined,
    ).toEqual(inherited);
  });

  it('reads the previous completed Run the reply names, not the newest one', async () => {
    // Two completed Runs answer one turn; the reply names the older, which is
    // the Run whose answer and receipts a later summary must reproduce.
    const chatId = crypto.randomUUID();
    const seeded = await tenantDb.runAs(userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Previous completed Run',
      });
      const trigger = await messagesRepo.create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: USER_TEXT }],
      });
      const older = await runsRepo.markFinished(
        (
          await runsRepo.create({
            chatId,
            messageId: trigger.id,
            userId,
            modelId: MODEL_ID,
          })
        ).id,
        userId,
        'completed',
      );
      await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: trigger.id,
        parts: [{ type: 'text', text: 'the older answer' }],
        usage: { status: 'completed', complete: true, runId: older!.id },
      });
      await runsRepo.markFinished(
        (
          await runsRepo.create({
            chatId,
            messageId: trigger.id,
            userId,
            modelId: MODEL_ID,
          })
        ).id,
        userId,
        'completed',
      );
      return { seq: trigger.seq, olderId: older!.id };
    });

    // Nothing precedes the trigger, so no reply is answerable yet.
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findCompletedReplyRunBefore(chatId, userId, {
          beforeSeq: seeded.seq,
        }),
      ),
    ).resolves.toBeUndefined();
    // The newest completed Run answers this turn too, so only the reply's
    // usage can name the one that produced the answer the model read.
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findCompletedReplyRunBefore(chatId, userId, {
          // Any sequence after this turn's reply stands for a later turn.
          beforeSeq: seeded.seq + 10,
        }),
      ),
    ).resolves.toMatchObject({ run: { id: seeded.olderId } });
  });

  it('reuses the stored prompt-imports item and stores no second one', async () => {
    const turn = await seedContinuedTurn({ promptImportsItem: true });

    await execute(turn, scriptedClient(scriptedModel(answerChunks('done'))));

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'prompt-imports'),
    ).toHaveLength(1);
  });

  it('finalizes kept parts and its own in-Run item once when the worker dies', async () => {
    const keptItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: crypto.randomUUID(),
        payload: {},
        text: '<system-reminder producer="instructions">kept item</system-reminder>',
      },
    };
    // The kept boundary carries the item an earlier Run authored, so the
    // rebuild must not place a second copy of it.
    const turn = await seedContinuedTurn({
      replyParts: [...keptParts, keptItem],
    });
    const ownItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: turn.runId,
        payload: {},
        text: '<system-reminder producer="instructions">own item</system-reminder>',
      },
    };
    // Attempt A dispatched and stored a part snapshot holding its own in-Run
    // item, then died without settling.
    await tenantDb.runAs(userId, async (tx) => {
      const runsRepo = new RunsRepository(tx);
      const started = await runsRepo.markStarted(turn.runId, userId);
      const attemptId = started?.activeAttemptId;
      if (!attemptId) throw new Error('Attempt A did not claim the Run.');
      const events = new RunEventsRepository(tx);
      await events.append(turn.runId, 'run.started');
      await events.append(turn.runId, 'model.requested', {
        modelId: MODEL_ID,
        attemptId,
      });
      await events.append(turn.runId, 'model.delta', { text: 'half' });
      await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        usage: {
          status: 'running',
          complete: false,
          runId: turn.runId,
          attemptId,
          modelId: MODEL_ID,
        },
      });
      await new RunningReplyRepository(tx).updateRunningReplyParts({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        attemptId,
        parts: [...keptParts, keptItem, ownItem],
      });
    });

    await runExecution.settleTerminalRun({
      userId,
      runId: turn.runId,
      status: 'failed',
      runPayload: { status: 'failed' },
      error: { message: 'the worker died' },
    });

    const reply = await replyOf(turn);
    // The kept parts come first, once (the kept item they carried included),
    // then the attempt's own item — no rebuilt part holds a kept call id, so it
    // goes at the start of the rebuilt reply — then the attempt's output.
    expect(reply?.parts).toEqual([
      ...keptParts,
      keptItem,
      ownItem,
      { type: 'text', text: 'half' },
    ]);
  });
});

/** The tool-result part for `toolCallId` in the request the Run sent. */
function toolResultOf(
  messages: Array<ModelMessage>,
  toolCallId: string,
): ToolResultPart | undefined {
  return messages.flatMap((message) =>
    message.role === 'tool' && Array.isArray(message.content)
      ? message.content.filter(
          (part): part is ToolResultPart =>
            part.type === 'tool-result' && part.toolCallId === toolCallId,
        )
      : [],
  )[0];
}

/** The recorded result of one kept part, when it is a settled `read` call. */
function keptResultOf(
  part: unknown,
):
  | { toolCallId: string; output: { status: 'success' } & UnknownRecord }
  | undefined {
  if (!isRecord(part)) return undefined;
  const toolCallId = part['toolCallId'];
  const output = part['output'];
  return isString(toolCallId) &&
    isRecord(output) &&
    output['status'] === 'success'
    ? { toolCallId, output: { ...output, status: 'success' } }
    : undefined;
}
