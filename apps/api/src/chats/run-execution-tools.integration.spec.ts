/**
 * Tool-event persistence integration test (tool-calling loop MVP).
 *
 * Closes the coverage gap flagged when the loop shipped: the fakes ignore
 * tools and the mechanism test used in-memory arrays, so the
 * executeRun → run_events persistence path (and the P0 ordering fix) was
 * typechecked and built but never DRIVEN by a test. This runs the REAL AI SDK
 * tool loop through RunExecutionService.executeRun against a live Postgres and
 * asserts the recorded run-event trace — the agents-best-practices property
 * "could the run be audited or safely rerun from recorded state."
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { stepCountIs, streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { PolicyService } from '../policies/policy.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

/**
 * A ModelClient backed by a scripted MockLanguageModelV3 — the REAL `ai`
 * streamText, forwarding the `tools`/`maxSteps` executeRun passes it, so the
 * tool wrapper actually runs. Mirrors createOpenAIModelClient minus the
 * provider. This is what makes the test non-vacuous.
 */
function createMockModelClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
    streamText(input: ModelStreamInput) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        ...(input.tools
          ? { tools: input.tools, stopWhen: stepCountIs(input.maxSteps ?? 4) }
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

/** Step that streams some text, then calls get_current_time. */
function textThenToolCallResponse(pre: string) {
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
          toolName: 'get_current_time',
          input: JSON.stringify({ timezone: 'UTC' }),
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

describeIfDb('executeRun tool-event persistence', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: RunExecutionService;
  let userId: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    // Post-turn compaction/titling call the model — stub them out so the mock
    // is exercised only by the turn under test (they have their own suites).
    const noopCompaction = { maybeCompact: async () => {} } as never;
    const noopTitles = { maybeGenerateTitle: async () => {} } as never;
    // Real PolicyService: with no policies seeded, every tool resolves 'unset'
    // → the safe allowlist, so the tool loop behaves exactly as before.
    const policies = new PolicyService(tenantDb);
    service = new RunExecutionService(
      tenantDb,
      noopCompaction,
      noopTitles,
      policies,
    );

    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Tools', ${`tools-${userId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('persists tool.call/tool.result in stream order, flushing buffered deltas first, and completes', async () => {
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      // Chat owned by the user (RLS insert requires owner = current user).
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'what time is it in UTC?' }],
      });
    });

    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({ chatId, messageId, userId }),
    );

    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? textThenToolCallResponse('Let me check the clock. ')
            : textResponse('It is currently that time in UTC.'),
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

    // Tool events present and paired in order.
    expect(idx('tool.call')).toBeGreaterThan(-1);
    expect(idx('tool.result')).toBe(idx('tool.call') + 1);

    // THE P0: the step-1 text ("Let me check the clock. ") was buffered and
    // MUST be flushed to a model.delta BEFORE the tool events — else replay
    // order is corrupt. The first model.delta precedes tool.call.
    expect(idx('model.delta')).toBeGreaterThan(-1);
    expect(idx('model.delta')).toBeLessThan(idx('tool.call'));

    // model.completed / run.completed come after the tool ran.
    expect(idx('model.completed')).toBeGreaterThan(idx('tool.result'));

    // sequence is strictly monotonic (append-only, ordered log).
    const seqs = events.map((e) => e.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // Payloads: the tool call carries name + args; the result carries status.
    const call = events.find((e) => e.eventType === 'tool.call')!;
    expect(call.payload).toMatchObject({
      toolName: 'get_current_time',
      args: { timezone: 'UTC' },
    });
    const toolResult = events.find((e) => e.eventType === 'tool.result')!;
    expect(toolResult.payload).toMatchObject({
      toolName: 'get_current_time',
      status: 'success',
    });

    // The run completed and the assistant's final answer persisted.
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
    expect(JSON.stringify(assistant?.parts)).toContain('that time in UTC');

    // Cleanup this chat (owner-scoped).
    await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userId),
    );
    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
