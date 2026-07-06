/**
 * Custom-instructions end-to-end wiring: a run whose config_snapshot carries
 * the user's instructions → the system prompt reaching the model contains the
 * non-authoritative block (and a run with none is unchanged). Proves the
 * snapshot → snapshotInstructions → applyUserInstructions → buildContext link
 * the reviewers flagged as load-bearing. Capturing mock, live DB.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { streamText } from 'ai';
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
import { RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

function answer(t: string) {
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

/** Captures the `system` string passed into the model call. */
function capturingClient(sink: { system?: string }): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
    streamText(input: ModelStreamInput) {
      sink.system = input.system;
      return streamText({
        model: new MockLanguageModelV3({
          doStream: () => Promise.resolve(answer('ok')),
        }),
        system: input.system,
        messages: input.messages,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
        },
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

async function waitFor(
  poll: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
) {
  const start = Date.now();
  while (!(await poll())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describeIfDb('custom instructions reach the system prompt', () => {
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
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'CI', ${`ci-${userId}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  async function runWith(
    configSnapshot: unknown,
  ): Promise<{ system?: string }> {
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
        parts: [{ type: 'text', text: 'hi' }],
      });
    });
    const run = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId,
        userId,
        configSnapshot,
      }),
    );
    const sink: { system?: string } = {};
    try {
      const result = await service.executeRun({
        runId: run.id,
        chatId,
        userId,
        userMessage: {
          id: userMessage.id,
          seq: userMessage.seq,
          parts: userMessage.parts as { type: 'text'; text: string }[],
        },
        client: capturingClient(sink),
      });
      await result.consumeStream?.();
      await waitFor(() => sink.system !== undefined);
    } finally {
      // Always clean up, even if executeRun/consumeStream/waitFor throws —
      // otherwise a failing case leaks a chat row into the shared test DB.
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
    return sink;
  }

  it('merges resolved instructions into the system prompt as a labeled block', async () => {
    const sink = await runWith({
      effective: { instructions: 'Always answer in haiku.' },
    });
    expect(sink.system).toContain(
      '<user_preferences priority="non-authoritative">',
    );
    expect(sink.system).toContain('Always answer in haiku.');
    expect(sink.system).toContain('do NOT override');
  });

  it('leaves the system prompt as the plain base when no instructions are set', async () => {
    const sink = await runWith({ effective: {} });
    expect(sink.system).not.toContain('<user_preferences');
  });
});
