/**
 * Reasoning-token end-to-end proof through the real loop (master slice of
 * #150's reasoning split — no tool loop here, so this exercises only the
 * reasoning<->text cross-flush, not the flush-before-tool.call invariant,
 * which stays on the tool-loop branch). A mock reasoning model emits a
 * thinking stream, then the answer; the run captures reasoning-delta and
 * persists `reasoning.delta` run-events IN STREAM ORDER — before the answer
 * text (the cross-flush fix) — and, on completion, persists the accumulated
 * thinking as a leading `reasoning` part of the assistant message so it
 * survives a reload. Proves capture -> persist (events) -> persist (message)
 * -> ordering against a live DB.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { streamText } from 'ai';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
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

function createMockModelClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
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

// One turn: reasoning (sub-threshold, stays buffered) -> text, no tool.
// Without the cross-flush at the top of onTextDelta, the buffered reasoning
// tail would only flush at onFinish — landing AFTER the answer in the log.
function reasoningThenText() {
  return {
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
  } as any;
}

// Reasoning starts, some partial answer text streams, then the model errors
// out (no finish). Proves the onError path keeps BOTH the reasoning AND the
// partial answer that already streamed -- same "show what the user actually
// saw" honesty the codebase already applies to partial text on its own.
function reasoningThenErrorMidAnswer() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'thinking before it dies' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'partial answer' },
        { type: 'error', error: new Error('provider dropped the stream') },
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

describeIfDb('reasoning tokens end-to-end (master, no tool loop)', () => {
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
    const noopCompaction = { maybeCompact: async () => {} } as never;
    const noopTitles = { maybeGenerateTitle: async () => {} } as never;
    // No tools configured (BUILT_IN_DEFAULTS.tools.allowed is empty) — this
    // suite is master's answer-only loop, no tool loop involved.
    const instanceConfig = { config: BUILT_IN_DEFAULTS } as never;
    service = new RunExecutionService(
      tenantDb,
      noopCompaction,
      noopTitles,
      instanceConfig,
      noopReindexDispatch(),
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

  it('reasoning precedes the answer in the event log (cross-flush) and is persisted as a leading part', async () => {
    const chatId = crypto.randomUUID();
    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'think then answer' }],
      });
    });
    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId: userMessage.id,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      }),
    );

    const model = new MockLanguageModelV3({
      doStream: () => Promise.resolve(reasoningThenText()),
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

    // reasoning was captured and persisted as a run-event…
    expect(types.indexOf('reasoning.delta')).toBeGreaterThan(-1);
    const reasoning = events.find((e) => e.eventType === 'reasoning.delta')!;
    expect((reasoning.payload as { text: string }).text).toContain(
      'brief thought',
    );
    // …and, WITHOUT the cross-flush, it would land AFTER model.delta — the P0
    // this test proves is fixed.
    expect(types.indexOf('reasoning.delta')).toBeLessThan(
      types.indexOf('model.delta'),
    );
    // sequence is monotonic.
    const seqs = events.map((e) => e.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

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

  it('keeps both the reasoning and the partial answer when the stream errors mid-turn', async () => {
    const chatId = crypto.randomUUID();
    const userMessage = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      return new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'think then die' }],
      });
    });
    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId: userMessage.id,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      }),
    );

    const model = new MockLanguageModelV3({
      doStream: () => Promise.resolve(reasoningThenErrorMidAnswer()),
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
      return events.some(
        (e) => e.eventType === 'run.completed' || e.eventType === 'run.failed',
      );
    });

    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    const parts = assistant?.parts as { type: string; text: string }[];
    // Both survive the abort -- reasoning is not silently dropped while the
    // partial answer is kept.
    expect(parts).toEqual([
      { type: 'reasoning', text: 'thinking before it dies' },
      { type: 'text', text: 'partial answer' },
    ]);

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
