/**
 * Reasoning-token end-to-end proof through the real loop. A mock reasoning
 * model emits a thinking stream, then a tool call, then the answer; the run
 * captures reasoning-delta and persists `reasoning.delta` run-events IN STREAM
 * ORDER — before the tool events (the flush-before-tool fix, adversarial P0)
 * and before the text. Proves capture → persist → ordering against a live DB.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
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
import { PolicyService } from '../policies/policy.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

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

function reasoningThenTool() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'reasoning-start', id: 'r1' },
        {
          type: 'reasoning-delta',
          id: 'r1',
          delta: 'I should check the time.',
        },
        { type: 'reasoning-end', id: 'r1' },
        {
          type: 'tool-call',
          toolCallId: 'c1',
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

function text(t: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: t },
        { type: 'text-end', id: 't' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

async function waitFor(poll: () => Promise<boolean>, timeoutMs = 8000) {
  const start = Date.now();
  while (!(await poll())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describeIfDb('reasoning tokens end-to-end', () => {
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
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    const noop = { maybeCompact: async () => {} } as never;
    const noopTitles = { maybeGenerateTitle: async () => {} } as never;
    const policies = new PolicyService(tenantDb);
    const config = { get: () => undefined } as never;
    service = new RunExecutionService(
      tenantDb,
      noop,
      noopTitles,
      policies,
      config,
    );
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'R', ${`r-${userId}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('persists reasoning.delta before the tool events and the answer (stream order)', async () => {
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
        parts: [{ type: 'text', text: 'what time is it?' }],
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
          turn === 1 ? reasoningThenTool() : text('It is now.'),
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

    // reasoning was captured and persisted.
    expect(idx('reasoning.delta')).toBeGreaterThan(-1);
    const reasoning = events.find((e) => e.eventType === 'reasoning.delta')!;
    expect((reasoning.payload as { text: string }).text).toContain(
      'check the time',
    );
    // THE P0: reasoning lands BEFORE the tool call (flushed by the tool wrapper),
    // not after it.
    expect(idx('reasoning.delta')).toBeLessThan(idx('tool.call'));
    // and before the final answer text.
    expect(idx('reasoning.delta')).toBeLessThan(idx('model.delta'));
    // sequence is monotonic.
    const seqs = events.map((e) => e.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('reasoning precedes the answer on a NO-tool run (the onTextDelta cross-flush)', async () => {
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
        parts: [{ type: 'text', text: 'think then answer' }],
      });
    });
    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({ chatId, messageId, userId }),
    );

    // One turn: reasoning (sub-threshold, stays buffered) → text, no tool.
    const model = new MockLanguageModelV3({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'reasoning-start', id: 'r1' },
              { type: 'reasoning-delta', id: 'r1', delta: 'brief thought' },
              { type: 'reasoning-end', id: 'r1' },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'Here it is.' },
              { type: 'text-end', id: 't' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ] as any,
          }),
        } as any),
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
    // Without the cross-flush, reasoning.delta would land AFTER model.delta.
    expect(types.indexOf('reasoning.delta')).toBeGreaterThan(-1);
    expect(types.indexOf('reasoning.delta')).toBeLessThan(
      types.indexOf('model.delta'),
    );

    // Reasoning is PERSISTED in the assistant message (survives reload): a
    // leading `reasoning` part, then the answer text.
    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    const parts = assistant?.parts as { type: string; text: string }[];
    expect(parts?.[0]).toEqual({ type: 'reasoning', text: 'brief thought' });
    expect(
      parts?.some((p) => p.type === 'text' && p.text === 'Here it is.'),
    ).toBe(true);

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
