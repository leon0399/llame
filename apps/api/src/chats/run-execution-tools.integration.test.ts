/**
 * Tool-loop persistence integration test (openspec/changes/tool-calling-loop).
 *
 * Runs the REAL `ai` streamText (via a scripted MockLanguageModelV3) through
 * RunExecutionService.executeRun against a live Postgres, driving the
 * `search_conversations` tool (the one shipped tool) end-to-end:
 * tool.requested/started/completed events land in stream order, the
 * assistant message persists a `tool-search_conversations` part, and a run
 * that keeps requesting tools past `tools.maxStepsPerRun` is forced to
 * answer and persists the step-cap marker part. The
 * agents-best-practices property under test: "could the run be audited or
 * safely rerun from recorded state."
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import {
  asSchema,
  NoSuchToolError,
  stepCountIs,
  streamText,
  type StepResult,
  type ToolSet,
} from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { type ChatReindexDispatcher } from '../search/search-reindex-dispatch.service';
import { drizzle } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  type ChatSearchIndexer,
  RunExecutionService,
} from '../runs/run-execution.service';
import { type DynamicToolExecutorResolver } from '../runs/snapshot-tool-execution';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { seedModelContextSnapshot } from '../runs/model-context-snapshot.test-fixture';
import { createRunEventTranslator } from '../runs/run-stream-bridge';
import { SearchIndexService } from '../search/search-index.service';
import { TOOL_REGISTRY } from '../tools/registry';
import { hashToolDeclaration } from '../tools/turn-tool-catalog';
import { type Tool, type ToolContext } from '../tools/types';
import { turnTelemetryLogger } from './turn-telemetry';
import {
  createModelSwitchPart,
  renderModelSwitchReminder,
} from './model-context-part';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

/**
 * A ModelClient backed by a scripted MockLanguageModelV3 — the REAL `ai`
 * streamText, forwarding everything executeRun passes it (tools, maxSteps,
 * prepareStep-equivalent cap enforcement, the refusal seam), mirroring
 * createOpenAIModelClient minus the provider. This is what makes the test
 * non-vacuous: the SAME cap/refusal plumbing openai-model-client.ts ships is
 * exercised here against a real multi-step AI SDK loop.
 */
function createMockModelClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
    contextWindowTokens: 100_000,
    streamText(input: ModelStreamInput) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        ...(input.tools
          ? {
              tools: input.tools,
              stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
              prepareStep: ({ steps }: { steps: StepResult<ToolSet>[] }) => {
                const priorToolSteps = steps.filter(
                  (step) => step.toolCalls.length > 0,
                ).length;
                if (priorToolSteps >= (input.maxSteps ?? 8)) {
                  input.onCapReached?.();
                  return { activeTools: [] };
                }
                return {};
              },
              experimental_repairToolCall: ({
                toolCall,
                error,
              }: {
                toolCall: {
                  toolCallId: string;
                  toolName: string;
                  // Matches the real LanguageModelV3ToolCall shape: input is
                  // ALWAYS a stringified JSON object at this layer, never
                  // pre-parsed — mirrors openai-model-client.ts's own
                  // parseToolCallInput best-effort parse.
                  input: string;
                };
                error: unknown;
              }) => {
                let parsedInput: unknown;
                try {
                  parsedInput = JSON.parse(toolCall.input) as unknown;
                } catch {
                  parsedInput = toolCall.input;
                }
                input.onUnavailableToolCall?.({
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: parsedInput,
                  reason: NoSuchToolError.isInstance(error)
                    ? ('not_available' as const)
                    : ('invalid_input' as const),
                });
                return Promise.resolve(null);
              },
            }
          : {}),
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') {
            input.onTextDelta?.(chunk.text);
          } else if (chunk.type === 'reasoning-delta') {
            input.onReasoningDelta?.(chunk.text);
          }
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

function textDelta(id: string, delta: string) {
  return { type: 'text-delta', id, delta };
}

/** Step that streams some text, then calls search_conversations. */
function textThenToolCallResponse(pre: string, query: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'p' },
        textDelta('p', pre),
        { type: 'text-end', id: 'p' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search_conversations',
          input: JSON.stringify({ query }),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

/** A step that reasons, writes text, then requests a tool. */
function reasoningTextThenToolCallResponse(pre: string, query: string) {
  const response = textThenToolCallResponse(pre, query);
  response.stream = simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: 'I should search first. ' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-start', id: 'p' },
      textDelta('p', pre),
      { type: 'text-end', id: 'p' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'search_conversations',
        input: JSON.stringify({ query }),
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ] as any,
  });
  return response;
}

/** A step that requests a tool NOT in the advertised toolSet (unlisted or
 * hallucinated) — the AI SDK raises NoSuchToolError, routed through
 * experimental_repairToolCall to onUnavailableToolCall. */
function unlistedToolCallResponse(toolName: string, query: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'call-bad',
          toolName,
          input: JSON.stringify({ query }),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

/** A provider tool call with caller-controlled JSON input. Used to prove the
 * real AI SDK validates JSON-Schema arguments before invoking the executor. */
function jsonToolCallResponse(
  toolCallId: string,
  toolName: string,
  input: unknown,
) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId,
          toolName,
          input: JSON.stringify(input),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

/** A step that ALWAYS requests the tool again (never answers) — drives the
 * loop to the step cap. */
function alwaysToolCallResponse(callId: string, query: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: callId,
          toolName: 'search_conversations',
          input: JSON.stringify({ query }),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

function textResponse(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'a' },
        textDelta('a', text),
        { type: 'text-end', id: 'a' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

async function waitFor(
  poll: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!(await poll())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describeIfDb('executeRun tool-loop persistence', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let userId: string;

  function serviceWithTools(overrides?: {
    maxStepsPerRun?: number;
    allowed?: string[];
    searchIndex?: ChatSearchIndexer;
    reindexDispatch?: ChatReindexDispatcher;
    dynamicToolResolver?: DynamicToolExecutorResolver;
  }): RunExecutionService {
    const noopCompaction = { maybeCompact: async () => {} } as never;
    const noopTitles = { maybeGenerateTitle: async () => {} } as never;
    const instanceConfig = {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          allowed: overrides?.allowed ?? ['search_conversations'],
          maxStepsPerRun:
            overrides?.maxStepsPerRun ?? BUILT_IN_DEFAULTS.tools.maxStepsPerRun,
          callTimeoutSeconds: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
        },
      },
    } as never;
    return new RunExecutionService(
      tenantDb,
      noopCompaction,
      noopTitles,
      instanceConfig,
      overrides?.searchIndex ?? new SearchIndexService(tenantDb),
      overrides?.reindexDispatch ?? noopReindexDispatch(),
      overrides?.dynamicToolResolver,
    );
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);

    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Tools', ${`tools-${userId}@test.com`})`;

    // A chat search_conversations can genuinely match, so the tool's own
    // ChatsRepository.searchByOwner call exercises a real result (not just
    // an empty-array happy path).
    await tenantDb.runAs(userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const seedChatId = crypto.randomUUID();
      await chatsRepo.createIfAbsent({
        id: seedChatId,
        ownerUserId: userId,
        title: 'Budget planning',
      });
      await messagesRepo.create({
        chatId: seedChatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'notes about the annual budget' }],
      });
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  async function seedBoundRun(
    key: string,
    toolIds: readonly string[] = ['search_conversations'],
  ) {
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const seeded = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Snapshot execution',
      });
      const userMessage = await new MessagesRepository(tx).create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'use the bound context' }],
      });
      const snapshot = await seedModelContextSnapshot(tx, userId, key, toolIds);
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: `test:${key}`,
        modelContextSnapshotId: snapshot.id,
      });
      return { userMessage, snapshot, run };
    });

    return { chatId, messageId, key, ...seeded };
  }

  function recordingClient(calls: ModelStreamInput[]): ModelClient {
    const delegate = createMockModelClient(
      new MockLanguageModelV3({
        doStream: () => Promise.resolve(textResponse('snapshot response')),
      }),
    );
    return {
      ...delegate,
      model: 'snapshot-target',
      streamText(input) {
        calls.push(input);
        return delegate.streamText(input);
      },
    };
  }

  async function executeSeeded(
    seeded: Awaited<ReturnType<typeof seedBoundRun>>,
    service: RunExecutionService,
    client: ModelClient,
  ) {
    return service.executeRun({
      runId: seeded.run.id,
      chatId: seeded.chatId,
      userId,
      userMessage: {
        id: seeded.userMessage.id,
        seq: seeded.userMessage.seq,
        parts: seeded.userMessage.parts as { type: 'text'; text: string }[],
      },
      client,
    });
  }

  it('retry-exhaustion finalization settles durable open calls before run.expired and persists them in request order', async () => {
    const reindexChat = vi.fn().mockResolvedValue(undefined);
    const enqueueChatReindex = vi.fn().mockResolvedValue(undefined);
    const service = serviceWithTools({
      searchIndex: { reindexChat },
      reindexDispatch: { enqueueChatReindex },
    });
    const touchSpy = vi.spyOn(ChatsRepository.prototype, 'touch');
    const telemetryLog = vi
      .spyOn(turnTelemetryLogger, 'info')
      .mockImplementation(() => {});
    const seeded = await seedBoundRun(`dead-letter-${crypto.randomUUID()}`);
    await tenantDb.runAs(userId, async (tx) => {
      const events = new RunEventsRepository(tx);
      await events.append(seeded.run.id, 'model.delta', { text: 'Before. ' });
      await events.append(seeded.run.id, 'tool.requested', {
        toolCallId: 'dead-call',
        toolName: 'search_conversations',
        input: { query: 'budget' },
      });
      await events.append(seeded.run.id, 'model.delta', { text: 'After.' });
    });

    try {
      const first = await service.settleTerminalRun({
        runId: seeded.run.id,
        userId,
        status: 'expired',
        runPayload: { status: 'expired', message: 'retries exhausted' },
        error: { message: 'retries exhausted' },
      });
      const duplicate = await service.settleTerminalRun({
        runId: seeded.run.id,
        userId,
        status: 'expired',
        runPayload: { status: 'expired', message: 'retries exhausted' },
        error: { message: 'retries exhausted' },
      });

      expect(first.outcome).toBe('won');
      expect(duplicate.outcome).toBe('lost');

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      const types = events.map((event) => event.eventType);
      expect(types.filter((type) => type === 'tool.completed')).toHaveLength(1);
      expect(types.indexOf('tool.completed')).toBeLessThan(
        types.indexOf('run.expired'),
      );
      expect(
        events.find((event) => event.eventType === 'tool.completed')?.payload,
      ).toMatchObject({
        toolCallId: 'dead-call',
        status: 'error',
        output: { type: 'cancelled' },
      });

      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(seeded.chatId, userId),
      );
      const assistant = messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.inReplyTo === seeded.userMessage.id,
      );
      expect(assistant?.parts).toEqual([
        { type: 'text', text: 'Before. ' },
        expect.objectContaining({
          type: 'tool-search_conversations',
          toolCallId: 'dead-call',
          state: 'output-error',
          resultProviderMetadata: { llame: { cancelled: true } },
        }),
        { type: 'text', text: 'After.' },
      ]);
      expect(assistant?.usage).toBeNull();
      expect(touchSpy).toHaveBeenCalledTimes(1);
      expect(touchSpy).toHaveBeenCalledWith(seeded.chatId, userId);
      expect(reindexChat).toHaveBeenCalledTimes(1);
      expect(reindexChat).toHaveBeenCalledWith(seeded.chatId, userId);
      expect(enqueueChatReindex).not.toHaveBeenCalled();
      expect(telemetryLog).not.toHaveBeenCalled();
    } finally {
      touchSpy.mockRestore();
      telemetryLog.mockRestore();
      await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
    }
  });

  it('progress-write failure settles the durable open call before run.failed and persists it', async () => {
    const reindexChat = vi
      .fn()
      .mockRejectedValue(new Error('simulated inline reindex failure'));
    const enqueueChatReindex = vi.fn().mockResolvedValue(undefined);
    const service = serviceWithTools({
      searchIndex: { reindexChat },
      reindexDispatch: { enqueueChatReindex },
    });
    const settlementSpy = vi.spyOn(service, 'settleTerminalRun');
    const touchSpy = vi
      .spyOn(ChatsRepository.prototype, 'touch')
      .mockRejectedValueOnce(new Error('simulated chat touch failure'));
    const telemetryLog = vi
      .spyOn(turnTelemetryLogger, 'info')
      .mockImplementation(() => {});
    const seeded = await seedBoundRun(
      `progress-failure-${crypto.randomUUID()}`,
    );
    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? textThenToolCallResponse('Before. ', 'budget')
            : textResponse('After.'),
        );
      },
    });
    // Bound dynamically with `.call(this, ...)` below so the repository's
    // private DB handle remains the instance under test.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalAppend = RunEventsRepository.prototype.append;
    let rejectedCompletion = false;
    const appendSpy = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation(function (
        this: RunEventsRepository,
        runId,
        eventType,
        payload,
      ) {
        if (eventType === 'tool.completed' && !rejectedCompletion) {
          rejectedCompletion = true;
          return Promise.reject(new Error('simulated progress write failure'));
        }
        return originalAppend.call(this, runId, eventType, payload);
      });

    try {
      const result = await executeSeeded(
        seeded,
        service,
        createMockModelClient(model),
      );
      await result.consumeStream?.();

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      const types = events.map((event) => event.eventType);
      expect(types.filter((type) => type === 'tool.completed')).toHaveLength(1);
      expect(types.indexOf('tool.completed')).toBeLessThan(
        types.indexOf('run.failed'),
      );

      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(seeded.chatId, userId),
      );
      const assistant = messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.inReplyTo === seeded.userMessage.id,
      );
      expect(assistant?.parts).toContainEqual(
        expect.objectContaining({
          type: 'tool-search_conversations',
          toolCallId: 'call-1',
          state: 'output-error',
          resultProviderMetadata: { llame: { cancelled: true } },
        }),
      );
      expect(assistant?.usage).toEqual(
        expect.objectContaining({ runId: seeded.run.id }),
      );
      expect(settlementSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: seeded.run.id,
          userId,
          status: 'failed',
          telemetry: expect.objectContaining({ runId: seeded.run.id }),
        }),
      );
      expect(touchSpy).toHaveBeenCalledTimes(1);
      expect(reindexChat).toHaveBeenCalledTimes(1);
      expect(reindexChat).toHaveBeenCalledWith(seeded.chatId, userId);
      expect(enqueueChatReindex).toHaveBeenCalledTimes(1);
      expect(enqueueChatReindex).toHaveBeenCalledWith(seeded.chatId, userId);
      expect(telemetryLog).toHaveBeenCalledTimes(1);
    } finally {
      appendSpy.mockRestore();
      settlementSpy.mockRestore();
      touchSpy.mockRestore();
      telemetryLog.mockRestore();
      await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
    }
  });

  it('rejects terminal settlement when an open-call completion cannot commit', async () => {
    const service = serviceWithTools();
    const seeded = await seedBoundRun(
      `settlement-failure-${crypto.randomUUID()}`,
    );
    await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).append(seeded.run.id, 'tool.requested', {
        toolCallId: 'unsettled-call',
        toolName: 'search_conversations',
        input: { query: 'budget' },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalAppend = RunEventsRepository.prototype.append;
    const appendSpy = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation(function (
        this: RunEventsRepository,
        runId,
        eventType,
        payload,
      ) {
        if (eventType === 'tool.completed') {
          return Promise.reject(new Error('simulated settlement failure'));
        }
        return originalAppend.call(this, runId, eventType, payload);
      });

    try {
      await expect(
        service.settleTerminalRun({
          runId: seeded.run.id,
          userId,
          status: 'expired',
          runPayload: { status: 'expired' },
        }),
      ).rejects.toThrow(
        `Could not durably settle terminal run ${seeded.run.id}.`,
      );

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      expect(events.map((event) => event.eventType)).not.toContain(
        'run.expired',
      );
    } finally {
      appendSpy.mockRestore();
      await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
    }
  });

  it('uses the bound prompt and exact snapshotted tool declaration without re-intersecting the mutable operator allowlist', async () => {
    const service = serviceWithTools({ allowed: [] });
    const seeded = await seedBoundRun(`bound-${crypto.randomUUID()}`);
    const calls: ModelStreamInput[] = [];

    const result = await executeSeeded(seeded, service, recordingClient(calls));
    await result.consumeStream?.();

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(seeded.snapshot.systemPrompt);
    expect(calls[0].system).toBe(`Test prompt: ${seeded.key}`);
    expect(Object.keys(calls[0].tools ?? {})).toEqual(['search_conversations']);

    const snapshotDeclaration = seeded.snapshot.toolDeclarations[0];
    const advertised = calls[0].tools?.['search_conversations'];
    expect(advertised?.description).toBe(snapshotDeclaration.description);
    expect(await asSchema(advertised!.inputSchema).jsonSchema).toEqual(
      snapshotDeclaration.inputSchema,
    );

    await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
  });

  it('binds an exact worker-local dynamic executor through the normal result persistence and replay path', async () => {
    const toolId = 'mcp__web__search';
    const seedExecute = vi.fn(() => ({ status: 'success' as const }));
    const seedTool: Tool = {
      id: toolId,
      description: 'Search current fixture evidence.',
      classification: 'read_only',
      inputSchema: z.object({ query: z.string().min(1) }).strict(),
      execute: seedExecute,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(toolId, seedTool);
    let seeded: Awaited<ReturnType<typeof seedBoundRun>> | undefined;

    try {
      seeded = await seedBoundRun(`dynamic-${crypto.randomUUID()}`, [toolId]);
      registry.delete(toolId);
      const declaration = seeded.snapshot.toolDeclarations[0];
      const execute = vi.fn(
        (context: ToolContext, args: Record<string, unknown>) => ({
          status: 'success' as const,
          evidence: `${String(args['query'])}: current`,
          observedToolCallId: context.toolCallId,
          receivedAbortSignal: context.abortSignal instanceof AbortSignal,
        }),
      );
      const liveTool: Tool = { ...seedTool, execute };
      const dynamicToolResolver: DynamicToolExecutorResolver = {
        resolveDynamicTool: (id) =>
          id === toolId
            ? {
                state: 'available',
                declarationHash: hashToolDeclaration(declaration),
                executor: liveTool,
              }
            : { state: 'not_dynamic' },
      };
      let turn = 0;
      const model = new MockLanguageModelV3({
        doStream: () => {
          turn += 1;
          return Promise.resolve(
            turn === 1
              ? jsonToolCallResponse('dynamic-call', toolId, {
                  query: 'release notes',
                })
              : textResponse('The dynamic search completed.'),
          );
        },
      });
      const service = serviceWithTools({
        allowed: [toolId],
        dynamicToolResolver,
      });
      const result = await executeSeeded(
        seeded,
        service,
        createMockModelClient(model),
      );
      await result.consumeStream?.();

      expect(seedExecute).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          chatId: seeded.chatId,
          toolCallId: 'dynamic-call',
          abortSignal: expect.any(AbortSignal),
        }),
        { query: 'release notes' },
      );

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded!.run.id, userId),
      );
      expect(
        events.find((event) => event.eventType === 'tool.completed')?.payload,
      ).toMatchObject({
        toolCallId: 'dynamic-call',
        status: 'success',
        output: {
          status: 'success',
          evidence: 'release notes: current',
          observedToolCallId: 'dynamic-call',
          receivedAbortSignal: true,
        },
      });

      const later = await tenantDb.runAs(userId, async (tx) => {
        const userMessage = await new MessagesRepository(tx).create({
          chatId: seeded!.chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'replay the prior evidence' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId: seeded!.chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:dynamic-replay',
          modelContextSnapshotId: seeded!.snapshot.id,
        });
        return { userMessage, run };
      });
      const replayedCalls: ModelStreamInput[] = [];
      const laterResult = await service.executeRun({
        runId: later.run.id,
        chatId: seeded.chatId,
        userId,
        userMessage: {
          id: later.userMessage.id,
          seq: later.userMessage.seq,
          parts: later.userMessage.parts as MessagePart[],
        },
        client: recordingClient(replayedCalls),
      });
      await laterResult.consumeStream?.();

      expect(JSON.stringify(replayedCalls[0].messages)).toContain(
        'release notes: current',
      );
    } finally {
      registry.delete(toolId);
      if (seeded !== undefined) {
        await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
      }
    }
  });

  it('settles a withdrawn configured dynamic tool as not_available and continues to a code-owned sibling', async () => {
    const toolId = 'mcp__offline__search';
    const remoteExecute = vi.fn(() => ({ status: 'success' as const }));
    const remoteTool: Tool = {
      id: toolId,
      description: 'Search the offline fixture.',
      classification: 'read_only',
      inputSchema: z.object({ query: z.string() }).strict(),
      execute: remoteExecute,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(toolId, remoteTool);
    let seeded: Awaited<ReturnType<typeof seedBoundRun>> | undefined;

    try {
      seeded = await seedBoundRun(`withdrawn-${crypto.randomUUID()}`, [
        toolId,
        'search_conversations',
      ]);
      registry.delete(toolId);
      const resolveDynamicTool = vi.fn((id: string) =>
        id === toolId
          ? ({ state: 'unavailable' } as const)
          : ({ state: 'not_dynamic' } as const),
      );
      let turn = 0;
      const model = new MockLanguageModelV3({
        doStream: () => {
          turn += 1;
          if (turn === 1) {
            return Promise.resolve(
              jsonToolCallResponse('offline-call', toolId, {
                query: 'current evidence',
              }),
            );
          }
          if (turn === 2) {
            return Promise.resolve(
              textThenToolCallResponse(
                'Trying local history instead. ',
                'budget',
              ),
            );
          }
          return Promise.resolve(textResponse('I continued with local data.'));
        },
      });
      const result = await executeSeeded(
        seeded,
        serviceWithTools({
          allowed: [toolId, 'search_conversations'],
          dynamicToolResolver: { resolveDynamicTool },
        }),
        createMockModelClient(model),
      );
      await result.consumeStream?.();

      expect(remoteExecute).not.toHaveBeenCalled();
      expect(resolveDynamicTool).toHaveBeenCalledWith(toolId);
      expect(resolveDynamicTool).not.toHaveBeenCalledWith(
        'search_conversations',
      );
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded!.run.id, userId),
      );
      const completions = events.filter(
        (event) => event.eventType === 'tool.completed',
      );
      expect(completions).toHaveLength(2);
      expect(completions[0]?.payload).toMatchObject({
        toolCallId: 'offline-call',
        status: 'error',
        output: { status: 'error', type: 'not_available' },
      });
      expect(completions[1]?.payload).toMatchObject({
        toolCallId: 'call-1',
        status: 'success',
      });
      expect(events.map((event) => event.eventType)).toContain('run.completed');
    } finally {
      registry.delete(toolId);
      if (seeded !== undefined) {
        await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
      }
    }
  });

  it('isolates a malformed JSON-Schema sibling while the valid tool executes, persists, and replays on the next run', async () => {
    const validToolId = 'json_schema_lookup';
    const malformedToolId = 'malformed_json_schema';
    const executeValid = vi.fn(
      (_context: ToolContext, args: Record<string, unknown>) => ({
        status: 'success' as const,
        echo: args['query'],
      }),
    );
    const executeMalformed = vi.fn(() => ({
      status: 'success' as const,
    }));
    const validTool: Tool = {
      id: validToolId,
      description: 'Echo one validated lookup query.',
      classification: 'read_only',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: executeValid,
    };
    const malformedTool: Tool = {
      id: malformedToolId,
      description: 'Must be isolated before snapshotting.',
      classification: 'read_only',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'definitely-not-a-json-schema-type',
      },
      execute: executeMalformed,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(validToolId, validTool);
    registry.set(malformedToolId, malformedTool);
    const chatId = crypto.randomUUID();

    try {
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'JSON Schema integration',
        });
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'look up alpha' }],
        });
        const snapshot = await seedModelContextSnapshot(
          tx,
          userId,
          `json-schema-${crypto.randomUUID()}`,
          [validToolId, malformedToolId],
        );
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:json-schema',
          modelContextSnapshotId: snapshot.id,
        });
        return { userMessage, snapshot, run };
      });

      expect(seeded.snapshot.toolDeclarations.map(({ id }) => id)).toEqual([
        validToolId,
      ]);

      let turn = 0;
      const model = new MockLanguageModelV3({
        doStream: () => {
          turn += 1;
          return Promise.resolve(
            turn === 1
              ? jsonToolCallResponse('json-valid-call', validToolId, {
                  query: 'alpha',
                })
              : textResponse('The validated lookup completed.'),
          );
        },
      });
      const advertisedCalls: ModelStreamInput[] = [];
      const delegate = createMockModelClient(model);
      const result = await serviceWithTools({
        allowed: [validToolId, malformedToolId],
      }).executeRun({
        runId: seeded.run.id,
        chatId,
        userId,
        userMessage: {
          id: seeded.userMessage.id,
          seq: seeded.userMessage.seq,
          parts: seeded.userMessage.parts as MessagePart[],
        },
        client: {
          ...delegate,
          streamText(input) {
            advertisedCalls.push(input);
            return delegate.streamText(input);
          },
        },
      });
      await result.consumeStream?.();

      expect(Object.keys(advertisedCalls[0].tools ?? {})).toEqual([
        validToolId,
      ]);
      expect(executeValid).toHaveBeenCalledTimes(1);
      expect(executeValid).toHaveBeenCalledWith(
        expect.objectContaining({ userId, chatId }),
        { query: 'alpha' },
      );
      expect(executeMalformed).not.toHaveBeenCalled();

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      expect(
        events
          .filter((event) => event.eventType.startsWith('tool.'))
          .map((event) => event.eventType),
      ).toEqual(['tool.requested', 'tool.started', 'tool.completed']);
      expect(
        events.find((event) => event.eventType === 'tool.completed')?.payload,
      ).toMatchObject({
        toolCallId: 'json-valid-call',
        output: { status: 'success', echo: 'alpha' },
      });

      const later = await tenantDb.runAs(userId, async (tx) => {
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'what did that tool return?' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:json-schema',
          modelContextSnapshotId: seeded.snapshot.id,
        });
        return { userMessage, run };
      });
      const replayedCalls: ModelStreamInput[] = [];
      const laterResult = await serviceWithTools({
        allowed: [validToolId],
      }).executeRun({
        runId: later.run.id,
        chatId,
        userId,
        userMessage: {
          id: later.userMessage.id,
          seq: later.userMessage.seq,
          parts: later.userMessage.parts as MessagePart[],
        },
        client: recordingClient(replayedCalls),
      });
      await laterResult.consumeStream?.();

      const replayedHistory = JSON.stringify(replayedCalls[0].messages);
      expect(replayedHistory).toContain(`"toolName":"${validToolId}"`);
      expect(replayedHistory).toContain('"query":"alpha"');
      expect(replayedHistory).toContain('\\\"echo\\\":\\\"alpha\\\"');
      expect(replayedHistory).not.toContain(malformedToolId);
    } finally {
      registry.delete(validToolId);
      registry.delete(malformedToolId);
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });

  it('records SDK-rejected JSON-Schema arguments as invalid_input without starting the executor and continues the run', async () => {
    const toolId = 'json_schema_counter';
    const execute = vi.fn(() => ({ status: 'success' as const, count: 1 }));
    const registeredTool: Tool = {
      id: toolId,
      description: 'Accept one numeric count.',
      classification: 'read_only',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
        additionalProperties: false,
      },
      execute,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(toolId, registeredTool);
    const chatId = crypto.randomUUID();

    try {
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Invalid JSON Schema arguments',
        });
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'count this value' }],
        });
        const snapshot = await seedModelContextSnapshot(
          tx,
          userId,
          `json-schema-invalid-${crypto.randomUUID()}`,
          [toolId],
        );
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:json-schema-invalid',
          modelContextSnapshotId: snapshot.id,
        });
        return { userMessage, run };
      });

      let turn = 0;
      const model = new MockLanguageModelV3({
        doStream: () => {
          turn += 1;
          return Promise.resolve(
            turn === 1
              ? jsonToolCallResponse('json-invalid-call', toolId, {
                  count: 'not-a-number',
                })
              : textResponse('I continued after the invalid call.'),
          );
        },
      });
      const service = serviceWithTools({ allowed: [toolId] });
      const result = await service.executeRun({
        runId: seeded.run.id,
        chatId,
        userId,
        userMessage: {
          id: seeded.userMessage.id,
          seq: seeded.userMessage.seq,
          parts: seeded.userMessage.parts as MessagePart[],
        },
        client: createMockModelClient(model),
      });
      await result.consumeStream?.();

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      const callEvents = events.filter(
        (event) =>
          typeof event.payload === 'object' &&
          event.payload !== null &&
          'toolCallId' in event.payload &&
          event.payload.toolCallId === 'json-invalid-call',
      );
      expect(callEvents.map((event) => event.eventType)).toEqual([
        'tool.requested',
        'tool.completed',
      ]);
      expect(callEvents[1].payload).toMatchObject({
        output: { status: 'error', type: 'invalid_input' },
      });
      expect(execute).not.toHaveBeenCalled();
      expect(turn).toBe(2);
      expect(
        events.filter((event) => event.eventType === 'run.completed'),
      ).toHaveLength(1);

      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      const assistant = messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.inReplyTo === seeded.userMessage.id,
      );
      expect(assistant?.parts).toContainEqual(
        expect.objectContaining({
          type: `tool-${toolId}`,
          toolCallId: 'json-invalid-call',
          state: 'output-error',
          outcome: 'invalid_input',
        }),
      );
    } finally {
      registry.delete(toolId);
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });

  it('lets terminal settlement own the first and only tool completion when a cooperative tool rejects on parent abort', async () => {
    const toolId = 'cooperative_abort_tool';
    const controller = new AbortController();
    let signalToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      signalToolStarted = resolve;
    });
    const execute = vi.fn(
      (context: ToolContext): Promise<{ status: 'success' }> => {
        signalToolStarted();
        return new Promise((resolve, reject) => {
          const signal = context.abortSignal;
          if (!signal) {
            reject(
              new Error('expected the tool runner to supply an abort signal'),
            );
            return;
          }
          const rejectForAbort = () =>
            reject(new Error('cooperative tool observed parent abort'));
          if (signal.aborted) {
            rejectForAbort();
          } else {
            signal.addEventListener('abort', rejectForAbort, { once: true });
          }
        });
      },
    );
    const registeredTool: Tool = {
      id: toolId,
      description: 'Wait until the parent run is aborted.',
      classification: 'read_only',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(toolId, registeredTool);
    const chatId = crypto.randomUUID();

    try {
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Cooperative tool abort',
        });
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'wait for cancellation' }],
        });
        const snapshot = await seedModelContextSnapshot(
          tx,
          userId,
          `cooperative-abort-${crypto.randomUUID()}`,
          [toolId],
        );
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:cooperative-abort',
          modelContextSnapshotId: snapshot.id,
        });
        return { userMessage, run };
      });

      const model = new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve(jsonToolCallResponse('cooperative-call', toolId, {})),
      });
      const service = serviceWithTools({ allowed: [toolId] });
      const result = await service.executeRun({
        runId: seeded.run.id,
        chatId,
        userId,
        userMessage: {
          id: seeded.userMessage.id,
          seq: seeded.userMessage.seq,
          parts: seeded.userMessage.parts as MessagePart[],
        },
        client: createMockModelClient(model),
        abortSignal: controller.signal,
      });
      const consume = result.consumeStream?.();
      await toolStarted;
      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).requestCancel(seeded.run.id, userId),
      );
      controller.abort();
      await consume;

      await waitFor(async () => {
        const run = await tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.run.id, userId),
        );
        return run?.status === 'cancelled';
      });

      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      const completed = events.filter(
        (event) => event.eventType === 'tool.completed',
      );
      expect(completed).toHaveLength(1);
      expect(completed[0].payload).toMatchObject({
        toolCallId: 'cooperative-call',
        output: {
          status: 'error',
          type: 'cancelled',
          message: 'The run was cancelled before this tool finished.',
        },
      });
      expect(JSON.stringify(completed)).not.toContain('execution_failed');
      const types = events.map((event) => event.eventType);
      expect(types.indexOf('tool.completed')).toBeLessThan(
        types.indexOf('run.cancelled'),
      );
      expect(types.filter((type) => type === 'run.cancelled')).toHaveLength(1);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      registry.delete(toolId);
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });

  it.each([
    {
      name: 'fails the run after retrying a synthetic tool completion that first fails to persist',
      persistentlyFailCompletion: false,
    },
    {
      name: 'leaves the run nonterminal when its synthetic tool completion cannot be persisted',
      persistentlyFailCompletion: true,
    },
  ])('$name', async ({ persistentlyFailCompletion }) => {
    const toolId = 'cooperative_abort_tool_write_failure';
    const controller = new AbortController();
    let signalToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      signalToolStarted = resolve;
    });
    const execute = vi.fn(
      (context: ToolContext): Promise<{ status: 'success' }> => {
        signalToolStarted();
        return new Promise((_resolve, reject) => {
          const signal = context.abortSignal;
          if (!signal) {
            reject(
              new Error('expected the tool runner to supply an abort signal'),
            );
            return;
          }
          const rejectForAbort = () =>
            reject(new Error('cooperative tool observed parent abort'));
          if (signal.aborted) {
            rejectForAbort();
          } else {
            signal.addEventListener('abort', rejectForAbort, { once: true });
          }
        });
      },
    );
    const registeredTool: Tool = {
      id: toolId,
      description:
        'Wait until the parent run is aborted, then fail progress persistence.',
      classification: 'read_only',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute,
    };
    const registry = TOOL_REGISTRY as Map<string, Tool>;
    registry.set(toolId, registeredTool);
    const chatId = crypto.randomUUID();
    let failedSettlementWrite = false;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalAppend = RunEventsRepository.prototype.append;
    const appendSpy = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation(function (
        this: RunEventsRepository,
        runId,
        eventType,
        payload,
      ) {
        if (
          eventType === 'tool.completed' &&
          (persistentlyFailCompletion || !failedSettlementWrite) &&
          typeof payload === 'object' &&
          payload !== null &&
          'toolCallId' in payload &&
          payload.toolCallId === 'cooperative-call'
        ) {
          failedSettlementWrite = true;
          return Promise.reject(new Error('simulated settlement failure'));
        }
        return originalAppend.call(this, runId, eventType, payload);
      });

    try {
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Cooperative tool abort write failure',
        });
        const userMessage = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'wait for cancellation' }],
        });
        const snapshot = await seedModelContextSnapshot(
          tx,
          userId,
          `cooperative-abort-write-failure-${crypto.randomUUID()}`,
          [toolId],
        );
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: 'test:cooperative-abort-write-failure',
          modelContextSnapshotId: snapshot.id,
        });
        return { userMessage, run };
      });

      const model = new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve(jsonToolCallResponse('cooperative-call', toolId, {})),
      });
      const service = serviceWithTools({ allowed: [toolId] });
      const execution = await service.executeRun({
        runId: seeded.run.id,
        chatId,
        userId,
        userMessage: {
          id: seeded.userMessage.id,
          seq: seeded.userMessage.seq,
          parts: seeded.userMessage.parts as MessagePart[],
        },
        client: createMockModelClient(model),
        abortSignal: controller.signal,
      });
      const consume = execution.consumeStream?.() ?? Promise.resolve();

      await toolStarted;
      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).requestCancel(seeded.run.id, userId),
      );
      controller.abort();
      await consume;

      const run = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(seeded.run.id, userId),
      );
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
      );
      const types = events.map((event) => event.eventType);
      if (persistentlyFailCompletion) {
        expect(run?.status).toBe('running_model');
        expect(run?.finishedAt).toBeNull();
        expect(types).not.toContain('tool.completed');
        expect(
          types.some((eventType) =>
            [
              'run.completed',
              'run.failed',
              'run.cancelled',
              'run.expired',
            ].includes(eventType),
          ),
        ).toBe(false);
      } else {
        expect(run?.status).toBe('failed');
        expect(run?.finishedAt).not.toBeNull();
        expect(
          types.filter((eventType) => eventType === 'tool.completed'),
        ).toHaveLength(1);
        expect(types.indexOf('tool.completed')).toBeLessThan(
          types.indexOf('run.failed'),
        );
        expect(types).not.toContain('run.cancelled');
        expect(types).not.toContain('run.expired');
        expect(types).not.toContain('run.completed');
      }
    } finally {
      appendSpy.mockRestore();
      registry.delete(toolId);
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });

  it.each([
    {
      name: 'missing',
      mutate: (_original: Tool) => undefined,
    },
    {
      name: 'no longer read-only',
      mutate: (original: Tool): Tool => ({
        ...original,
        classification: 'write_low_risk',
      }),
    },
    {
      name: 'description drift',
      mutate: (original: Tool): Tool => ({
        ...original,
        description: `${original.description} changed after enqueue`,
      }),
    },
    {
      name: 'input-schema drift',
      mutate: (original: Tool): Tool => ({
        ...original,
        inputSchema: z.object({ changed: z.string() }).strict(),
      }),
    },
  ])(
    'fails before the provider call when the trusted executor is $name',
    async ({ mutate }) => {
      const service = serviceWithTools();
      const seeded = await seedBoundRun(`drift-${crypto.randomUUID()}`);
      const calls: ModelStreamInput[] = [];
      const registry = TOOL_REGISTRY as Map<string, Tool>;
      const original = registry.get('search_conversations');
      if (!original) {
        throw new Error('search_conversations must exist in the test registry');
      }

      const changed = mutate(original);
      if (changed) {
        registry.set('search_conversations', changed);
      } else {
        registry.delete('search_conversations');
      }

      try {
        await expect(
          executeSeeded(seeded, service, recordingClient(calls)),
        ).rejects.toThrow(/snapshot|tool|context/i);
        expect(calls).toHaveLength(0);
        const failed = await tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.run.id, userId),
        );
        expect(failed?.status).toBe('failed');
        const events = await tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
        );
        expect(
          events.filter((event) => event.eventType === 'run.failed'),
        ).toHaveLength(1);
      } finally {
        registry.set('search_conversations', original);
        await sql`DELETE FROM chats WHERE id = ${seeded.chatId}`;
      }
    },
  );

  it('assembles a model switch as target snapshot context, portable visible history, reminder, then new user text', async () => {
    const service = serviceWithTools({ allowed: [] });
    const chatId = crypto.randomUUID();
    const targetRunId = crypto.randomUUID();
    const switchPart = createModelSwitchPart({
      fromModelId: 'source-model',
      toModelId: 'target-model',
      runId: targetRunId,
    });

    const seeded = await tenantDb.runAs(userId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const runs = new RunsRepository(tx);
      await chats.createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Model switch execution',
      });
      const oldUser = await messages.create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'Old visible request.' }],
      });
      const sourceSnapshot = await seedModelContextSnapshot(
        tx,
        userId,
        'source-model',
      );
      const sourceRun = await runs.create({
        chatId,
        messageId: oldUser.id,
        userId,
        modelId: 'source-model',
        modelContextSnapshotId: sourceSnapshot.id,
      });
      await runs.markFinished(sourceRun.id, userId, 'completed');
      await messages.create({
        chatId,
        role: 'assistant',
        inReplyTo: oldUser.id,
        parts: [
          { type: 'reasoning', text: 'SECRET REASONING ARTIFACT' },
          { type: 'text', text: 'Old visible answer.' },
          { type: 'provider-native', data: 'PROVIDER NATIVE ARTIFACT' },
          {
            type: 'tool-search_conversations',
            toolCallId: 'old-call',
            state: 'output-available',
            input: { query: 'TOOL DISPLAY INPUT' },
            output: { status: 'success', value: 'TOOL DISPLAY OUTPUT' },
            outcome: 'success',
          },
        ],
      });
      await messages.create({
        chatId,
        role: 'system',
        parts: [{ type: 'text', text: 'SOURCE SYSTEM PROMPT ARTIFACT' }],
      });
      const targetUser = await messages.create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [switchPart, { type: 'text', text: 'Continue on target.' }],
      });
      const targetSnapshot = await seedModelContextSnapshot(
        tx,
        userId,
        'target-model',
        ['search_conversations'],
      );
      const targetRun = await runs.create({
        id: targetRunId,
        chatId,
        messageId: targetUser.id,
        userId,
        modelId: 'target-model',
        modelContextSnapshotId: targetSnapshot.id,
      });
      return { sourceSnapshot, targetUser, targetRun, targetSnapshot };
    });

    const calls: ModelStreamInput[] = [];
    const result = await service.executeRun({
      runId: seeded.targetRun.id,
      chatId,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUser.parts as MessagePart[],
      },
      client: recordingClient(calls),
    });
    await result.consumeStream?.();

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(seeded.targetSnapshot.systemPrompt);
    expect(Object.keys(calls[0].tools ?? {})).toEqual(['search_conversations']);
    expect(calls[0].messages).toEqual([
      { role: 'user', content: 'Old visible request.' },
      { role: 'assistant', content: 'Old visible answer.' },
      {
        role: 'assistant',
        content: [
          expect.objectContaining({
            type: 'tool-call',
            toolCallId: 'old-call',
            toolName: 'search_conversations',
          }),
        ],
      },
      {
        role: 'tool',
        content: [
          expect.objectContaining({
            type: 'tool-result',
            toolCallId: 'old-call',
            toolName: 'search_conversations',
          }),
        ],
      },
      {
        role: 'user',
        content: `${renderModelSwitchReminder(switchPart)}\n\nContinue on target.`,
      },
    ]);
    const providerInput = JSON.stringify(calls[0]);
    expect(providerInput).not.toContain(seeded.sourceSnapshot.systemPrompt);
    expect(providerInput).not.toContain('SECRET REASONING ARTIFACT');
    expect(providerInput).not.toContain('PROVIDER NATIVE ARTIFACT');
    expect(providerInput).toContain('TOOL DISPLAY INPUT');
    expect(providerInput).toContain('TOOL DISPLAY OUTPUT');
    expect(providerInput).not.toContain('SOURCE SYSTEM PROMPT ARTIFACT');

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('persists and replays reasoning → text → tool → text in the same order', async () => {
    const service = serviceWithTools();
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'find my budget notes' }],
      });
    });

    const run = await tenantDb.runAs(userId, async (tx) => {
      const snapshot = await seedModelContextSnapshot(
        tx,
        userId,
        'system:openai:gpt-5.4-mini',
        ['search_conversations'],
      );
      return new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: snapshot.id,
      });
    });

    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? reasoningTextThenToolCallResponse('Let me search. ', 'budget')
            : textResponse('Here is what I found about your budget.'),
        );
      },
    });

    const result = await service.executeRun({
      runId: run.id,
      chatId,
      userId,
      userMessage: {
        id: userMessage.id,
        seq: userMessage.seq,
        parts: userMessage.parts as { type: 'text'; text: string }[],
      },
      client: createMockModelClient(model),
    });
    await result.consumeStream?.();

    await waitFor(async () => {
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(run.id, userId),
      );
      return events.some((e) => e.eventType === 'run.completed');
    });

    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    const types = events.map((e) => e.eventType);
    const idx = (t: string) => types.indexOf(t);

    // Lifecycle bookends.
    expect(types[0]).toBe('run.started');
    expect(types[1]).toBe('model.requested');
    expect(types[types.length - 1]).toBe('run.completed');

    // Tool events present, in request -> started -> completed order.
    expect(idx('tool.requested')).toBeGreaterThan(-1);
    expect(idx('tool.started')).toBe(idx('tool.requested') + 1);
    expect(idx('tool.completed')).toBe(idx('tool.started') + 1);

    // The step-1 text ("Let me search. ") was buffered and MUST be flushed
    // to a model.delta BEFORE the tool events — else replay order is corrupt.
    expect(idx('model.delta')).toBeGreaterThan(-1);
    expect(idx('model.delta')).toBeLessThan(idx('tool.requested'));
    expect(idx('reasoning.delta')).toBeGreaterThan(-1);
    expect(idx('reasoning.delta')).toBeLessThan(idx('model.delta'));

    // model.completed / run.completed come after the tool ran.
    expect(idx('model.completed')).toBeGreaterThan(idx('tool.completed'));
    expect(
      events.find((e) => e.eventType === 'model.completed')?.payload,
    ).toMatchObject({ telemetry: { runId: run.id } });

    // sequence is strictly monotonic (append-only, ordered log).
    const seqs = events.map((e) => e.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // Payloads: requested carries name + input; completed carries status.
    const requested = events.find((e) => e.eventType === 'tool.requested')!;
    expect(requested.payload).toMatchObject({
      toolName: 'search_conversations',
      input: { query: 'budget' },
    });
    const completed = events.find((e) => e.eventType === 'tool.completed')!;
    expect(completed.payload).toMatchObject({
      toolName: 'search_conversations',
      status: 'success',
    });

    // No step-cap event for a run that finishes well under the cap.
    expect(idx('run.step_cap_reached')).toBe(-1);

    const finished = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.id, userId),
    );
    expect(finished?.status).toBe('completed');

    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find(
      (m) => m.role === 'assistant' && m.inReplyTo === messageId,
    );
    expect(assistant).toBeDefined();
    expect(assistant?.usage).toMatchObject({ runId: run.id });
    const parts = assistant?.parts as Array<{
      type: string;
      state?: string;
      output?: unknown;
    }>;
    const toolPart = parts.find((p) => p.type === 'tool-search_conversations');
    expect(toolPart).toMatchObject({ state: 'output-available' });
    expect(parts.map((part) => part.type)).toEqual([
      'reasoning',
      'text',
      'tool-search_conversations',
      'text',
    ]);
    expect(JSON.stringify(assistant?.parts)).toContain(
      'found about your budget',
    );
    // No cap-notice part for a run that finishes under the cap.
    expect(parts.some((p) => p.type === 'data-cap-notice')).toBe(false);

    // A new bridge translator models reconnect/reload replay: it consumes the
    // same durable rows from sequence zero and emits the identical ordered UI
    // parts, rather than relying on in-memory model callback order.
    const replay = () => {
      const translator = createRunEventTranslator(run.id);
      return events.flatMap((event) => translator.translate(event));
    };
    const liveChunks = replay();
    const reconnectChunks = replay();
    expect(reconnectChunks).toEqual(liveChunks);
    expect(liveChunks.map((chunk) => chunk.type)).toEqual(
      expect.arrayContaining([
        'reasoning-start',
        'reasoning-delta',
        'reasoning-end',
        'text-start',
        'text-end',
        'tool-input-available',
        'tool-output-available',
        'finish',
      ]),
    );

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('records an unlisted/hallucinated tool call as a refusal: tool.requested + tool.completed(error) with no tool.started, and a persisted output-error part', async () => {
    const service = serviceWithTools();
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'do something with a made-up tool' }],
      });
    });

    const run = await tenantDb.runAs(userId, async (tx) => {
      const snapshot = await seedModelContextSnapshot(
        tx,
        userId,
        'system:openai:gpt-5.4-mini',
        ['search_conversations'],
      );
      return new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: snapshot.id,
      });
    });

    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? unlistedToolCallResponse('not_a_real_tool', 'budget')
            : textResponse('I could not use that tool, but here is an answer.'),
        );
      },
    });

    const result = await service.executeRun({
      runId: run.id,
      chatId,
      userId,
      userMessage: {
        id: userMessage.id,
        seq: userMessage.seq,
        parts: userMessage.parts as { type: 'text'; text: string }[],
      },
      client: createMockModelClient(model),
    });
    await result.consumeStream?.();

    await waitFor(async () => {
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(run.id, userId),
      );
      return events.some((e) => e.eventType === 'run.completed');
    });

    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    const types = events.map((e) => e.eventType);
    const idx = (t: string) => types.indexOf(t);

    // (a) tool.requested + tool.completed(error) recorded; NO tool.started —
    // the call never passed the gate, so it never genuinely ran.
    expect(idx('tool.requested')).toBeGreaterThan(-1);
    expect(types.filter((t) => t === 'tool.started')).toHaveLength(0);
    expect(idx('tool.completed')).toBeGreaterThan(idx('tool.requested'));

    const requested = events.find((e) => e.eventType === 'tool.requested')!;
    expect(requested.payload).toMatchObject({
      toolName: 'not_a_real_tool',
      input: { query: 'budget' },
    });
    const completed = events.find((e) => e.eventType === 'tool.completed')!;
    expect(completed.payload).toMatchObject({
      toolName: 'not_a_real_tool',
      status: 'error',
    });

    // The run is not crashed — it continues to a normal completion.
    const finished = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.id, userId),
    );
    expect(finished?.status).toBe('completed');

    // (b) a persisted tool-<name> part with state 'output-error' carries the
    // refusal on the assistant message.
    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find(
      (m) => m.role === 'assistant' && m.inReplyTo === messageId,
    );
    expect(assistant).toBeDefined();
    const parts = assistant?.parts as Array<{
      type: string;
      state?: string;
      errorText?: string;
    }>;
    const toolPart = parts.find((p) => p.type === 'tool-not_a_real_tool');
    expect(toolPart).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('not available') as string,
      outcome: 'not_available',
    });
    expect(JSON.stringify(assistant?.parts)).toContain(
      'could not use that tool',
    );

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('forces the model to answer at the step cap, recording a distinct cap event and a persisted cap-notice part', async () => {
    const service = serviceWithTools({ maxStepsPerRun: 2 });
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'keep searching for budget notes' }],
      });
    });

    const run = await tenantDb.runAs(userId, async (tx) => {
      const snapshot = await seedModelContextSnapshot(
        tx,
        userId,
        'system:openai:gpt-5.4-mini',
        ['search_conversations'],
      );
      return new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: snapshot.id,
      });
    });

    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        // Turns 1 and 2 keep requesting the tool (never answering); by
        // AI SDK's own no-tool-call stop rule the loop would run forever
        // without the cap — with maxStepsPerRun=2, the 3rd (forced,
        // tools-disabled) call has to answer with plain text.
        return Promise.resolve(
          turn <= 2
            ? alwaysToolCallResponse(`call-${turn}`, 'budget')
            : textResponse('I searched but hit the step limit.'),
        );
      },
    });

    const result = await service.executeRun({
      runId: run.id,
      chatId,
      userId,
      userMessage: {
        id: userMessage.id,
        seq: userMessage.seq,
        parts: userMessage.parts as { type: 'text'; text: string }[],
      },
      client: createMockModelClient(model),
    });
    await result.consumeStream?.();

    await waitFor(async () => {
      const events = await tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(run.id, userId),
      );
      return events.some((e) => e.eventType === 'run.completed');
    });

    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    const types = events.map((e) => e.eventType);

    // Exactly one distinct step-cap event, never shoehorned into
    // tool.completed.
    expect(types.filter((t) => t === 'run.step_cap_reached')).toHaveLength(1);
    const capEvent = events.find(
      (e) => e.eventType === 'run.step_cap_reached',
    )!;
    expect(capEvent.payload).toMatchObject({ stepsUsed: 2, maxSteps: 2 });

    // Two full tool-requesting steps ran (request/started/completed x2)
    // before the cap forced the answer.
    expect(types.filter((t) => t === 'tool.requested')).toHaveLength(2);
    expect(types.filter((t) => t === 'tool.completed')).toHaveLength(2);

    const finished = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.id, userId),
    );
    expect(finished?.status).toBe('completed');

    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find(
      (m) => m.role === 'assistant' && m.inReplyTo === messageId,
    );
    const parts = assistant?.parts as Array<{
      type: string;
      data?: { stepsUsed: number; maxSteps: number };
    }>;
    const capNotice = parts.find((p) => p.type === 'data-cap-notice');
    expect(capNotice).toMatchObject({ data: { stepsUsed: 2, maxSteps: 2 } });
    // The cap notice is the LAST part (after the forced answer text).
    expect(parts[parts.length - 1].type).toBe('data-cap-notice');
    expect(JSON.stringify(assistant?.parts)).toContain('hit the step limit');

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
