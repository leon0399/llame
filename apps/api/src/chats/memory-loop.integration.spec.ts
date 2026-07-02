/**
 * Agent-memory end-to-end proof (remember → persist → recall) through the REAL
 * loop. Closes the gap flagged across the memory iterations: the tools were
 * unit-tested with a fake context, but the full arc — TOOLS_ENABLED lights up
 * `remember` → the model calls it → the row persists under RLS → the model
 * calls `recall` → it returns the memory — was never driven through
 * executeRun + the real AI SDK loop against a live DB.
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
import { MemoriesRepository } from './memories-repository';
import { RunExecutionService } from './run-execution.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const MEMORY = 'Leo prefers dark mode for the UI';

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

function toolCall(id: string, toolName: string, input: unknown) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: id,
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

describeIfDb('agent memory loop (remember → recall) end-to-end', () => {
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
    // The operator has enabled the memory write tool instance-wide.
    const config = {
      get: (k: string) => (k === 'TOOLS_ENABLED' ? 'remember' : undefined),
    } as never;
    service = new RunExecutionService(
      tenantDb,
      noop,
      noopTitles,
      policies,
      config,
    );
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Mem', ${`mem-${userId}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('the model remembers a fact, it persists under RLS, then recall returns it', async () => {
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
        parts: [
          { type: 'text', text: 'remember my UI preference, then recall it' },
        ],
      });
    });
    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({ chatId, messageId, userId }),
    );

    // Turn 1: remember(MEMORY). Turn 2: recall("dark mode"). Turn 3: answer.
    let turn = 0;
    const model = new MockLanguageModelV3({
      doStream: () => {
        turn += 1;
        if (turn === 1)
          return Promise.resolve(
            toolCall('c1', 'remember', { content: MEMORY }),
          );
        if (turn === 2)
          return Promise.resolve(
            toolCall('c2', 'recall', { query: 'dark mode' }),
          );
        return Promise.resolve(text('Saved and recalled your preference.'));
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

    // 1) remember PERSISTED the memory under RLS (visible only to the user).
    const memories = await tenantDb.runAs(userId, (tx) =>
      new MemoriesRepository(tx).search('dark mode', userId, 5),
    );
    expect(memories.map((m) => m.content)).toContain(MEMORY);

    // 2) BOTH tool calls ran and are in the durable trace, in order.
    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    const calls = events
      .filter((e) => e.eventType === 'tool.call')
      .map((e) => (e.payload as { toolName: string }).toolName);
    expect(calls).toEqual(['remember', 'recall']);

    // 3) recall's result surfaced the just-saved memory back to the model.
    const recallResult = events.find(
      (e) =>
        e.eventType === 'tool.result' &&
        (e.payload as { toolName?: string }).toolName === 'recall',
    );
    expect(JSON.stringify(recallResult?.payload)).toContain(MEMORY);

    // 4) the run completed.
    const finished = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.id, userId),
    );
    expect(finished?.status).toBe('completed');

    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
