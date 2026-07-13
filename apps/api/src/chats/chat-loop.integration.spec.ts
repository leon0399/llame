/**
 * ChatLoopService single-flight regression (durable-run-workers, task 7.8) —
 * light-integration: a REAL Postgres + TenantDbService/repositories exercise
 * the actual `runs_chat_inflight_unique` partial index and its
 * catch/re-check/retry logic in persistUserMessageAndRun, with only the
 * execution-adjacent leaves mocked (ModelsService.validateModelSelection,
 * RunStreamBridgeService, RunDispatchService.dispatch) — the same
 * direct-instantiation-of-repos pattern as active-runs.integration.spec.ts.
 *
 * `chat-loop.service.spec.ts` already unit-tests the model-selection guard
 * against a fully mocked `tenantDb.runAs`; that mock cannot exercise a real
 * unique-constraint race, which is exactly what these tests guard: the D7
 * unwedge deletion (chat-loop.service.ts) narrowed single-flight enqueue to
 * "409 + vanished-blocker retry" with NO enqueue-side expiry — these three
 * scenarios are the ones that regression would silently break.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import { ConflictException } from '@nestjs/common';

import * as schema from '../db/schema';
import { type Run } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type ModelsService } from '../models/models.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { type RunDispatchService } from '../runs/run-dispatch.service';
import { type RunStreamBridgeService } from '../runs/run-stream-bridge';
import { RunsRepository } from '../runs/runs-repository';
import { ChatLoopService } from './chat-loop.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb(
  'ChatLoopService — single-flight regression (design D3/D7)',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let userId: string;
    let dispatchCalls: unknown[];
    let chatLoop: ChatLoopService;

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const postgres = require('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 5 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      userId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Chat Loop Regression', ${`chat-loop-regression-${userId}@test.com`})`;
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        await sql.end();
      }
    });

    beforeEach(() => {
      dispatchCalls = [];
      const models = {
        validateModelSelection: (modelId: string) => ({
          id: modelId,
          source: 'system' as const,
          provider: 'openai',
          providerModelId: modelId,
        }),
      } as unknown as ModelsService;
      const bridge = {
        createUiMessageStreamResponse: jest.fn(),
      } as unknown as RunStreamBridgeService;
      const aborts = new RunAbortRegistry();
      const dispatch = {
        dispatch: jest.fn((job: unknown) => {
          dispatchCalls.push(job);
          return Promise.resolve();
        }),
      } as unknown as RunDispatchService;

      chatLoop = new ChatLoopService(
        tenantDb,
        models,
        bridge,
        aborts,
        dispatch,
      );
    });

    const send = (chatId: string, messageId: string, text: string) =>
      chatLoop.createMessageStream({
        chatId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        message: { id: messageId, parts: [{ type: 'text', text }] },
      });

    const activeRun = (chatId: string) =>
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findActiveByChatId(chatId, userId),
      );

    it('rejects re-submitting an already-accepted message id — a message never produces two runs', async () => {
      const chatId = crypto.randomUUID();
      const messageId = crypto.randomUUID();

      await send(chatId, messageId, 'first send');
      const afterFirst = await activeRun(chatId);
      expect(afterFirst).toBeDefined();

      await expect(
        send(chatId, messageId, 'retry same id'),
      ).rejects.toBeInstanceOf(ConflictException);

      // No second run was created for the chat — still exactly the one.
      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(afterFirst!.id);
      expect(dispatchCalls).toHaveLength(1);
    });

    it('409s a DIFFERENT message while a non-terminal run is in flight for the chat, and leaves the blocker untouched', async () => {
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'blocker');
      const blocker = await activeRun(chatId);
      expect(blocker).toBeDefined();

      await expect(
        send(chatId, crypto.randomUUID(), 'a different message'),
      ).rejects.toBeInstanceOf(ConflictException);

      // The blocker is exactly as it was — this enqueue path never expires it
      // (design D7: that is the job-queue substrate's job now, not the API's).
      const stillBlocking = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(blocker!.id, userId),
      );
      expect(stillBlocking?.status).toBe(blocker!.status);
      expect(dispatchCalls).toHaveLength(1);
    });

    it('retries and succeeds when the blocker vanishes between the failed insert and the re-check (design D7 self-heal)', async () => {
      const chatId = crypto.randomUUID();

      await send(chatId, crypto.randomUUID(), 'blocker');
      const blocker = await activeRun(chatId);
      expect(blocker).toBeDefined();

      // Deterministically stand in for the race the production code's own
      // comment describes ("a blocker that VANISHED between our insert and
      // this read"): intercept the exact re-check call persistUserMessageAndRun
      // makes after catching the unique violation, and have a genuinely
      // separate, already-committed writer mark the blocker terminal right
      // before it runs — no sleep/timing, fully deterministic.
      const original: RunsRepository['findActiveByChatId'] =
        // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately grabbed unbound: re-invoked below via .call(this, ...) with an explicit receiver, not as a free-standing function.
        RunsRepository.prototype.findActiveByChatId;
      const spy = jest
        .spyOn(RunsRepository.prototype, 'findActiveByChatId')
        .mockImplementation(async function (
          this: RunsRepository,
          queriedChatId: string,
          queriedUserId: string,
        ): Promise<Run | undefined> {
          await tenantDb.runAs(queriedUserId, (tx2) =>
            new RunsRepository(tx2).markFinished(
              blocker!.id,
              queriedUserId,
              'cancelled',
            ),
          );
          return original.call(this, queriedChatId, queriedUserId) as Promise<
            Run | undefined
          >;
        });

      try {
        const retryMessageId = crypto.randomUUID();
        await expect(
          send(
            chatId,
            retryMessageId,
            'a different message, blocker just vanished',
          ),
        ).resolves.toBeDefined();
      } finally {
        spy.mockRestore();
      }

      // The blocker is now terminal (by the spy's side effect, not by
      // chat-loop) and a SECOND run was created and dispatched for the new
      // message — the retry succeeded rather than 409ing.
      const finishedBlocker = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(blocker!.id, userId),
      );
      expect(finishedBlocker?.status).toBe('cancelled');

      const runs = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findByChatId(chatId, userId),
      );
      expect(runs).toHaveLength(2);
      expect(dispatchCalls).toHaveLength(2);
    });
  },
);
