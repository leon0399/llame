import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { sql } from 'drizzle-orm';
import {
  stepCountIs,
  streamText as sdkStreamText,
  type LanguageModelUsage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { isRecord } from '@workspace/runtime-safety';

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { SearchIndexService } from '../search/search-index.service';
import { applyRequestUsageCallback } from '../models/request-usage';
import {
  type BillingMode,
  type ModelClient,
  type ModelStreamInput,
  type ModelStreamResult,
} from '../models/model-client';
import { waitFor, parseSseEvents } from '../testing/support';
import {
  registerTestOnlyTool,
  unregisterTestOnlyTool,
} from '../tools/registry';
import { type Tool, type ToolContext } from '../tools/types';
import { scriptedStreamHandlers } from './scripted-model-stream-options';
import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunStreamBridgeService } from './run-stream-bridge';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';
import { type RunUserMessage } from './run-execution.service';
import {
  awaitSettlementAfter,
  trackAbortSettlement,
} from '../testing/fake-streaming-model-client';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'run-usage-accounting.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 60_000 });

const OPEN_TOOL_ID = 'usage_accounting_open_tool';

let markOpenToolStarted: () => void = () => {};
let requestUsageReported = false;
let openToolSawRequestUsage = false;

const openTool: Tool = {
  id: OPEN_TOOL_ID,
  description: 'Wait for parent-run cancellation.',
  classification: 'read_only',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute(context: ToolContext) {
    openToolSawRequestUsage = requestUsageReported;
    markOpenToolStarted();
    const signal = context.abortSignal;
    if (!signal) {
      return Promise.reject(new Error('Expected the Run abort signal.'));
    }
    return new Promise<{ status: 'success' }>((_resolve, reject) => {
      const rejectForAbort = () => reject(new Error('Tool observed abort.'));
      if (signal.aborted) {
        rejectForAbort();
      } else {
        signal.addEventListener('abort', rejectForAbort, { once: true });
      }
    });
  },
};

type ProviderResponse = {
  parts: ReadonlyArray<LanguageModelV3StreamPart>;
  usage: LanguageModelV3Usage;
  finishReason?: LanguageModelV3FinishReason;
  beforeFinish?: {
    signalStarted: () => void;
    wait: Promise<void>;
  };
};
type ProviderRequest = ProviderResponse | { error: string };
type ModelScript = {
  requests: ReadonlyArray<ProviderRequest>;
  billing: BillingMode;
  onRequestUsage?: (usage: LanguageModelUsage) => void;
};

function providerUsage(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens = 0,
): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens - reasoningTokens,
      reasoning: reasoningTokens,
    },
  };
}

function textRequest(
  text: string,
  usage: LanguageModelV3Usage,
): ProviderResponse {
  return {
    parts: [
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: text },
      { type: 'text-end', id: 'answer' },
    ],
    usage,
  };
}

function toolRequest(
  toolCallId: string,
  toolName: string,
  usage: LanguageModelV3Usage,
  text?: string,
): ProviderResponse {
  return {
    parts: [
      ...(text
        ? [
            { type: 'text-start' as const, id: 'answer' },
            { type: 'text-delta' as const, id: 'answer', delta: text },
            { type: 'text-end' as const, id: 'answer' },
          ]
        : []),
      {
        type: 'tool-call',
        toolCallId,
        toolName,
        input: JSON.stringify({}),
      },
    ],
    usage,
  };
}

function providerStream(
  request: ProviderResponse,
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      const hasToolCall = request.parts.some(
        (part) => part.type === 'tool-call',
      );
      for (const part of request.parts) controller.enqueue(part);
      controller.enqueue({
        type: 'finish',
        finishReason:
          request.finishReason ??
          ({
            unified: hasToolCall ? 'tool-calls' : 'stop',
            raw: undefined,
          } satisfies LanguageModelV3FinishReason),
        usage: request.usage,
      });
      controller.close();
    },
  });
}

/**
 * A worker-harness model client with provider-request scripts. Its streams use
 * the same receipt wrapper as the production clients and the shared fakes.
 */
class UsageScriptedModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly contextWindowTokens = 128_000;
  readonly billing: BillingMode;

  constructor(
    readonly model: string,
    private readonly script: ModelScript,
  ) {
    this.billing = script.billing;
  }

  streamText(input: ModelStreamInput): ModelStreamResult {
    let requestIndex = 0;
    const model = new MockLanguageModelV3({
      provider: this.provider,
      modelId: this.model,
      doStream: async () => {
        const request = this.script.requests[requestIndex++];
        if (request === undefined) {
          throw new Error(
            `No scripted provider request remains for ${this.model}.`,
          );
        }
        if ('error' in request) throw new Error(request.error);
        if (request.beforeFinish !== undefined) {
          request.beforeFinish.signalStarted();
          await request.beforeFinish.wait;
        }
        return { stream: providerStream(request) };
      },
    });
    const settlement = trackAbortSettlement(input);
    const streamOptions = {
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...(input.tools !== undefined && {
        tools: input.tools,
        ...(input.toolChoice !== undefined && { toolChoice: input.toolChoice }),
        stopWhen: stepCountIs(input.maxSteps ?? 8),
      }),
      ...scriptedStreamHandlers(input, settlement),
    };
    const receiptInput: ModelStreamInput =
      input.onRequestUsage === undefined
        ? input
        : {
            ...input,
            onRequestUsage: (usage) => {
              this.script.onRequestUsage?.(usage);
              input.onRequestUsage?.(usage);
            },
          };
    applyRequestUsageCallback(streamOptions, receiptInput);
    return awaitSettlementAfter(sdkStreamText(streamOptions), settlement);
  }
}

function metadataUsages(stream: string): Array<unknown> {
  return parseSseEvents(stream)
    .filter(
      (chunk): chunk is { type: string; messageMetadata: unknown } =>
        isRecord(chunk) &&
        chunk.type === 'message-metadata' &&
        'messageMetadata' in chunk,
    )
    .map((chunk) => {
      if (!isRecord(chunk.messageMetadata)) return undefined;
      return chunk.messageMetadata['usage'];
    });
}

describe('Run usage accounting through the worker and Postgres', () => {
  let harness: WorkerHarness | undefined;
  let ownerId: string;
  const scripts = new Map<string, ModelScript>();
  const scriptsByAttempt = new Map<string, ReadonlyArray<ModelScript>>();
  const attemptsByModel = new Map<string, number>();

  beforeAll(async () => {
    registerTestOnlyTool(openTool);
    harness = await bootWorkerHarness({
      runsConcurrency: 3,
      allowedTools: [OPEN_TOOL_ID],
    });
    ownerId = await createUser(harness.db, `run-usage-${Date.now()}`);

    harness.models.createClient = (modelId) => {
      harness?.models.createClientCalls.push({ modelId });
      const attempt = attemptsByModel.get(modelId) ?? 0;
      attemptsByModel.set(modelId, attempt + 1);
      const attemptScripts = scriptsByAttempt.get(modelId);
      const script =
        attemptScripts === undefined
          ? scripts.get(modelId)
          : attemptScripts[Math.min(attempt, attemptScripts.length - 1)];
      if (script === undefined) {
        throw new Error(
          `No usage-accounting script registered for ${modelId}.`,
        );
      }
      return new UsageScriptedModelClient(modelId, script);
    };
  });

  afterAll(async () => {
    await harness?.close();
    unregisterTestOnlyTool(OPEN_TOOL_ID);
  });

  function runStatus(runId: string, userId = ownerId) {
    return harness!.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );
  }

  function runEvents(runId: string, userId = ownerId) {
    return harness!.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
  }

  function history(chatId: string, userId = ownerId) {
    return harness!.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
  }

  async function waitForStatus(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'expired',
    userId = ownerId,
  ) {
    return waitFor(
      async () => {
        const run = await runStatus(runId, userId);
        return run?.status === status ? run : undefined;
      },
      15_000,
      `Run ${runId} to reach ${status}`,
    );
  }

  async function waitForReply(
    chatId: string,
    userMessageId: string,
    userId = ownerId,
  ) {
    return waitFor(
      async () => {
        const messages = await history(chatId, userId);
        return messages.find(
          (message) =>
            message.role === 'assistant' && message.inReplyTo === userMessageId,
        );
      },
      15_000,
      `assistant reply to ${userMessageId}`,
    );
  }

  async function enqueue(
    seed: { chatId: string; runId: string; userMessage: RunUserMessage },
    modelId: string,
    userId = ownerId,
  ) {
    await dispatchRun({
      queue: harness!.queue,
      chatId: seed.chatId,
      runId: seed.runId,
      userId,
      modelId,
      userMessage: seed.userMessage,
    });
  }

  async function insertReceipt(
    userId: string,
    runId: string,
    attemptId: string = crypto.randomUUID(),
  ): Promise<void> {
    await harness!.tenantDb.runAs(userId, (tx) =>
      new SystemPromptReceiptsRepository(tx).create({
        ownerUserId: userId,
        runId,
        attemptId,
        source: 'model_override',
        systemPrompt: 'test prompt',
        promptHash: `receipt-${attemptId}`,
      }),
    );
  }

  it('persists an open-tool cancellation as an aborted turn excluded from search and reads (1.4)', async () => {
    const marker = `cancelledassistant${crypto.randomUUID().replaceAll('-', '')}`;
    const modelId = `test:run-usage:cancel:${crypto.randomUUID()}`;
    let resolveToolStarted: () => void = () => {};
    const toolStarted = new Promise<void>((resolve) => {
      resolveToolStarted = resolve;
    });
    markOpenToolStarted = resolveToolStarted;
    requestUsageReported = false;
    openToolSawRequestUsage = false;
    scripts.set(modelId, {
      billing: 'usage',
      requests: [
        toolRequest(
          'cancelled-open-call',
          OPEN_TOOL_ID,
          providerUsage(17, 5, 1),
          marker,
        ),
      ],
      onRequestUsage: () => {
        requestUsageReported = true;
      },
    });
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
      text: 'wait for the tool to open',
    });

    try {
      await enqueue(seed, modelId);
      await toolStarted;
      expect(openToolSawRequestUsage).toBe(true);
      await harness!.tenantDb.runAs(ownerId, (tx) =>
        new RunsRepository(tx).requestCancel(seed.runId, ownerId),
      );
      harness!.moduleRef
        .get(RunAbortRegistry, { strict: false })
        .abort(seed.runId);
      await waitForStatus(seed.runId, 'cancelled');

      const messages = await history(seed.chatId);
      const reply = messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.inReplyTo === seed.userMessage.id,
      );
      expect(reply?.usage).toMatchObject({
        inputTokens: 17,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 22,
        status: 'aborted',
        complete: false,
        billing: 'usage',
        modelId,
      });
      const control = await seedRun({
        tenantDb: harness!.tenantDb,
        userId: ownerId,
        modelId: `test:run-usage:search-control:${crypto.randomUUID()}`,
        text: 'search control question',
      });
      const controlReply = await harness!.tenantDb.runAs(ownerId, (tx) =>
        new MessagesRepository(tx).create({
          chatId: control.chatId,
          role: 'assistant',
          senderUserId: null,
          inReplyTo: control.userMessage.id,
          parts: [{ type: 'text', text: marker }],
          usage: { status: 'completed' },
        }),
      );

      const searchIndex = new SearchIndexService(harness!.tenantDb);
      await searchIndex.reindexChat(seed.chatId, ownerId);
      await searchIndex.reindexChat(control.chatId, ownerId);
      const searchResults = await harness!.tenantDb.runAs(ownerId, (tx) =>
        new ChatsRepository(tx).searchByOwner(ownerId, marker, { limit: 10 }),
      );
      expect(searchResults.map((result) => result.id)).toContain(
        control.chatId,
      );
      expect(searchResults.map((result) => result.id)).not.toContain(
        seed.chatId,
      );
      if (reply === undefined)
        throw new Error('Expected the aborted assistant reply.');
      await expect(
        harness!.tenantDb.runAs(ownerId, (tx) =>
          new MessagesRepository(tx).findConversationMessage(
            seed.chatId,
            ownerId,
            reply.seq,
          ),
        ),
      ).resolves.toBeUndefined();
      await expect(
        harness!.tenantDb.runAs(ownerId, (tx) =>
          new MessagesRepository(tx).findConversationMessage(
            control.chatId,
            ownerId,
            controlReply.seq,
          ),
        ),
      ).resolves.toMatchObject({
        seq: controlReply.seq,
        role: 'assistant',
        usage: { status: 'completed' },
      });
    } finally {
      harness!.moduleRef
        .get(RunAbortRegistry, { strict: false })
        .abort(seed.runId);
    }
  });

  it('marks a completed reclaimed Run incomplete and publishes the same finalized usage (1.5)', async () => {
    const modelId = `test:run-usage:reclaim:${crypto.randomUUID()}`;
    scripts.set(modelId, {
      billing: 'usage',
      requests: [textRequest('reclaimed answer', providerUsage(31, 8, 2))],
    });
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
    });
    const earlierAttempt = await harness!.tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).markStarted(seed.runId, ownerId),
    );
    if (!earlierAttempt?.activeAttemptId) {
      throw new Error('Expected a prompt-preparation attempt to be claimable.');
    }
    await insertReceipt(ownerId, seed.runId, earlierAttempt.activeAttemptId);

    await enqueue(seed, modelId);
    await waitForStatus(seed.runId, 'completed');

    const reply = await waitForReply(seed.chatId, seed.userMessage.id);
    expect(reply.usage).toMatchObject({
      inputTokens: 31,
      outputTokens: 8,
      reasoningTokens: 2,
      totalTokens: 39,
      status: 'completed',
      complete: false,
      billing: 'usage',
      modelId,
    });
    const receipts = await harness!.tenantDb.runAs(ownerId, (tx) =>
      new SystemPromptReceiptsRepository(tx).findByOwnedRun(
        seed.runId,
        ownerId,
      ),
    );
    expect(new Set(receipts.map((receipt) => receipt.attemptId)).size).toBe(2);

    const events = await runEvents(seed.runId);
    const modelCompleted = events.find(
      (event) => event.eventType === 'model.completed',
    );
    const terminal = events.find(
      (event) => event.eventType === 'run.completed',
    );
    expect(modelCompleted?.payload).toEqual(
      expect.objectContaining({ telemetry: reply.usage }),
    );
    expect(modelCompleted?.sequence).toBeLessThan(terminal?.sequence ?? 0);
  });

  it('persists late usage after expiry as incomplete (1.5)', async () => {
    const modelId = `test:run-usage:late-expiry:${crypto.randomUUID()}`;
    let releaseProvider: () => void = () => {};
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let signalProviderStarted: () => void = () => {};
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    scripts.set(modelId, {
      billing: 'subscription',
      requests: [
        {
          ...textRequest('late answer', providerUsage(41, 9)),
          beforeFinish: {
            signalStarted: signalProviderStarted,
            wait: providerReleased,
          },
        },
      ],
    });
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
    });

    try {
      await enqueue(seed, modelId);
      await providerStarted;
      const active = await runStatus(seed.runId);
      const activeAttemptId = active?.activeAttemptId;
      if (activeAttemptId === null || activeAttemptId === undefined) {
        throw new Error('Expected an active attempt.');
      }
      await harness!.tenantDb.runAs(ownerId, async (tx) => {
        const expired = await new RunsRepository(tx).markFinished(
          seed.runId,
          ownerId,
          'expired',
          { attemptId: activeAttemptId },
        );
        if (!expired) throw new Error('Expected to expire the active Run.');
        await new RunEventsRepository(tx).append(seed.runId, 'run.expired', {
          status: 'expired',
          message: 'Simulated expiry before provider completion.',
        });
      });
      releaseProvider();

      const reply = await waitForReply(seed.chatId, seed.userMessage.id);
      expect(reply.usage).toMatchObject({
        inputTokens: 41,
        outputTokens: 9,
        totalTokens: 50,
        status: 'completed',
        complete: false,
        billing: 'subscription',
        modelId,
      });
    } finally {
      releaseProvider();
    }
  });

  it('retries a salvaged failed reply and marks the replacement incomplete (1.5)', async () => {
    const modelId = `test:run-usage:salvage:${crypto.randomUUID()}`;
    let releaseRetryProvider: () => void = () => {};
    const retryProviderReleased = new Promise<void>((resolve) => {
      releaseRetryProvider = resolve;
    });
    let signalRetryProviderStarted: () => void = () => {};
    const retryProviderStarted = new Promise<void>((resolve) => {
      signalRetryProviderStarted = resolve;
    });
    scriptsByAttempt.set(modelId, [
      {
        billing: 'subscription',
        requests: [
          {
            ...textRequest(
              'known spend before failure',
              providerUsage(23, 7, 1),
            ),
            finishReason: { unified: 'error', raw: undefined },
          },
        ],
      },
      {
        billing: 'subscription',
        requests: [
          {
            ...textRequest('retried answer', providerUsage(23, 7, 1)),
            beforeFinish: {
              signalStarted: signalRetryProviderStarted,
              wait: retryProviderReleased,
            },
          },
        ],
      },
    ]);
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
    });
    const triggerSuffix = crypto.randomUUID().replaceAll('-', '');
    const triggerName = `test_usage_rollback_${triggerSuffix}`;
    const functionName = `test_usage_rollback_fn_${triggerSuffix}`;
    const removeFailureTrigger = async () => {
      await harness!.db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON run_events`),
      );
      await harness!.db.execute(
        sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`),
      );
    };

    try {
      await harness!.db.execute(
        sql.raw(`
          CREATE FUNCTION ${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $test$
          BEGIN
            IF NEW.run_id = '${seed.runId}'::uuid
              AND NEW.event_type = 'model.completed' THEN
              RAISE EXCEPTION 'Injected model.completed insert failure';
            END IF;
            RETURN NEW;
          END;
          $test$
        `),
      );
      await harness!.db.execute(
        sql.raw(`
          CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON run_events
          FOR EACH ROW EXECUTE FUNCTION ${functionName}()
        `),
      );
      await dispatchRun({
        queue: harness!.queue,
        chatId: seed.chatId,
        runId: seed.runId,
        userId: ownerId,
        modelId,
        userMessage: seed.userMessage,
        enqueueOptions: {
          retryLimit: 1,
          retryDelay: 0,
          retryBackoff: false,
        },
      });
      await retryProviderStarted;
      const salvaged = await waitForReply(seed.chatId, seed.userMessage.id);
      expect(await runStatus(seed.runId)).toMatchObject({
        status: 'running_model',
      });
      expect(salvaged.usage).toMatchObject({
        inputTokens: 23,
        outputTokens: 7,
        reasoningTokens: 1,
        totalTokens: 30,
        status: 'error',
        complete: false,
        billing: 'subscription',
      });
      const receipts = await harness!.tenantDb.runAs(ownerId, (tx) =>
        new SystemPromptReceiptsRepository(tx).findByOwnedRun(
          seed.runId,
          ownerId,
        ),
      );
      expect(new Set(receipts.map((receipt) => receipt.attemptId)).size).toBe(
        2,
      );

      await removeFailureTrigger();
      releaseRetryProvider();
      await waitForStatus(seed.runId, 'completed');
      const finalReply = await waitForReply(seed.chatId, seed.userMessage.id);
      expect(finalReply.id).toBe(salvaged.id);
      expect(finalReply.usage).toMatchObject({
        inputTokens: 23,
        outputTokens: 7,
        reasoningTokens: 1,
        totalTokens: 30,
        status: 'completed',
        complete: false,
        billing: 'subscription',
        modelId,
      });
    } finally {
      await removeFailureTrigger();
      releaseRetryProvider();
    }
  });

  it('ignores another Run’s prompt receipts during usage finalization (1.5)', async () => {
    const modelId = `test:run-usage:isolation:${crypto.randomUUID()}`;
    scripts.set(modelId, {
      billing: 'usage',
      requests: [textRequest('isolated answer', providerUsage(29, 4))],
    });
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
    });
    const sameOwnerOtherRun = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId: `${modelId}:other-run`,
    });
    await insertReceipt(ownerId, sameOwnerOtherRun.runId);
    await insertReceipt(ownerId, sameOwnerOtherRun.runId);
    const otherOwnerId = await createUser(
      harness!.db,
      `run-usage-isolation-${crypto.randomUUID()}`,
    );
    const otherOwnerRun = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: otherOwnerId,
      modelId: `${modelId}:other-owner-run`,
    });
    await insertReceipt(otherOwnerId, otherOwnerRun.runId);
    await insertReceipt(otherOwnerId, otherOwnerRun.runId);

    await enqueue(seed, modelId);
    await waitForStatus(seed.runId, 'completed');
    const reply = await waitForReply(seed.chatId, seed.userMessage.id);
    expect(reply.usage).toMatchObject({
      inputTokens: 29,
      outputTokens: 4,
      totalTokens: 33,
      status: 'completed',
      complete: true,
      billing: 'usage',
      modelId,
    });
  });

  it('streams failed-run usage that matches history and reconnect replay (1.8)', async () => {
    const modelId = `test:run-usage:failed-stream:${crypto.randomUUID()}`;
    scripts.set(modelId, {
      billing: 'subscription',
      requests: [
        {
          ...textRequest(
            'failed after a reported request',
            providerUsage(13, 4),
          ),
          finishReason: { unified: 'error', raw: undefined },
        },
      ],
    });
    const seed = await seedRun({
      tenantDb: harness!.tenantDb,
      userId: ownerId,
      modelId,
    });
    const bridge = harness!.moduleRef.get(RunStreamBridgeService, {
      strict: false,
    });
    const liveStream = bridge
      .createUiMessageStreamResponse({ runId: seed.runId, userId: ownerId })
      .text();
    await enqueue(seed, modelId);
    await waitForStatus(seed.runId, 'failed');

    const reply = await waitForReply(seed.chatId, seed.userMessage.id);
    expect(reply.usage).toMatchObject({
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      status: 'error',
      complete: false,
      billing: 'subscription',
      modelId,
    });
    const events = await runEvents(seed.runId);
    const completedIndex = events.findIndex(
      (event) => event.eventType === 'model.completed',
    );
    const failedIndex = events.findIndex(
      (event) => event.eventType === 'run.failed',
    );
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    expect(failedIndex).toBeGreaterThan(completedIndex);
    expect(events[completedIndex]?.payload).toEqual(
      expect.objectContaining({ telemetry: reply.usage }),
    );

    const liveUsages = metadataUsages(await liveStream);
    expect(liveUsages).toHaveLength(1);
    expect(liveUsages[0]).toEqual(reply.usage);
    expect(liveUsages[0]).toMatchObject({
      complete: false,
      billing: 'subscription',
    });

    const replayUsages = metadataUsages(
      await bridge
        .createUiMessageStreamResponse({ runId: seed.runId, userId: ownerId })
        .text(),
    );
    expect(replayUsages).toHaveLength(1);
    expect(replayUsages[0]).toEqual(liveUsages[0]);
    expect(replayUsages[0]).toEqual(reply.usage);
  });
});
