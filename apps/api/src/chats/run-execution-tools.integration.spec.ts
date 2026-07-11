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
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import {
  NoSuchToolError,
  stepCountIs,
  streamText,
  type StepResult,
  type ToolSet,
} from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

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
  }): RunExecutionService {
    const noopCompaction = { maybeCompact: async () => {} } as never;
    const noopTitles = { maybeGenerateTitle: async () => {} } as never;
    const instanceConfig = {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          allowed: ['search_conversations'],
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

  it('persists tool.requested/started/completed in stream order, flushing buffered deltas first, and completes with a tool-search_conversations part', async () => {
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

    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      }),
    );

    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? textThenToolCallResponse('Let me search. ', 'budget')
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

    // model.completed / run.completed come after the tool ran.
    expect(idx('model.completed')).toBeGreaterThan(idx('tool.completed'));

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
    const parts = assistant?.parts as Array<{
      type: string;
      state?: string;
      output?: unknown;
    }>;
    const toolPart = parts.find((p) => p.type === 'tool-search_conversations');
    expect(toolPart).toMatchObject({ state: 'output-available' });
    expect(JSON.stringify(assistant?.parts)).toContain(
      'found about your budget',
    );
    // No cap-notice part for a run that finishes under the cap.
    expect(parts.some((p) => p.type === 'data-cap-notice')).toBe(false);

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

    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      }),
    );

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

    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      }),
    );

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
