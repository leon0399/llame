/**
 * run-steering, `queue` layer — real HTTP + Postgres (RLS active) + the
 * co-located worker, with the fake model client: the pending items a send
 * stores while a Run is live, the owner's list and withdrawal, tenant
 * isolation, and the promotion of a queue item when a Run completes.
 *
 * A live Run is seeded through the repositories: with no queue job and a fresh
 * `created_at`, admission judges it live, as it would a Run that executes.
 *
 * Requires TEST_DATABASE_URL (throws without it); run by `test:integration`.
 */

import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { chatDeliveries } from '../db/schema';
import { pgErrorCode } from '../db/pg-error';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type TerminalRunStatus } from '../runs/run-status';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
  waitFor,
} from '../testing/support';
import { newChatJob } from '../testing/chat-job-rows';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from './chats-repository';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'chat-deliveries.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 60_000 });

const MODEL = 'system:openai:gpt-5.5';
const SECOND_MODEL = 'system:openai:gpt-5.4';
const THIRD_MODEL = 'system:openai:gpt-5.4-mini';

describe('chat deliveries — the queue mode', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;
  let executor: RunExecutionService;

  const tag = Date.now();
  let cookieA = '';
  let userAId = '';
  let cookieB = '';
  let userBId = '';

  async function register(email: string, name: string) {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password: 'password123', name });

    expect(res.status).toBe(201);
    const body: unknown = res.body;
    expectRegisteredUserId(body);

    return { cookie: cookieOf(res), userId: body.user.id };
  }

  beforeAll(async () => {
    models = new FakeModelsService();
    const instanceConfig = new InstanceConfigService();
    instanceConfig.config.tools.permissionModes = ['default'];

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .overrideProvider(InstanceConfigService)
      .useValue(instanceConfig)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    executor = app.get(RunExecutionService, { strict: false });
    const userA = await register(`deliveries-a-${tag}@example.com`, 'A');
    cookieA = userA.cookie;
    userAId = userA.userId;
    const userB = await register(`deliveries-b-${tag}@example.com`, 'B');
    cookieB = userB.cookie;
    userBId = userB.userId;
    models.registerReasoning(SECOND_MODEL, {
      effortLevels: [{ value: 'low' }, { value: 'high' }],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: false,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    models.client.turns.length = 0;
    models.client.responses = ['fake assistant'];
    models.client.delayMs = 0;
  });

  async function createChat(userId = userAId): Promise<string> {
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userId, title: 'Queue' }),
    );

    return chat.id;
  }

  /** A Chat with one Run that a send judges live. */
  async function chatWithLiveRun(
    options: { followUp?: boolean } = {},
  ): Promise<{ chatId: string; runId: string }> {
    const chatId = await createChat();

    return tenantDb.runAs(userAId, async (tx) => {
      const runs = new RunsRepository(tx);

      const message = await new MessagesRepository(
        tx,
      ).createUserMessageIfAbsent({
        id: crypto.randomUUID(),
        chatId,
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'seed' }],
      });

      if (!message) throw new Error('seed message not stored');
      let source: { id: string } | undefined;

      if (options.followUp) {
        source = await runs.create({
          chatId,
          messageId: message.id,
          userId: userAId,
          modelId: MODEL,
        });
        await runs.markFinished(source.id, userAId, 'failed', {
          error: { message: 'seeded failure' },
        });
      }

      const run = await runs.create({
        chatId,
        messageId: message.id,
        userId: userAId,
        modelId: MODEL,
        ...(source && { followUpAction: 'continue', sourceRunId: source.id }),
      });

      await runs.markStarted(run.id, userAId);

      return { chatId, runId: run.id };
    });
  }

  function send(
    chatId: string,
    body: {
      id?: string;
      text?: string;
      modelId?: string;
      effort?: string;
      delivery?: string;
    },
    cookie = cookieA,
  ) {
    return request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: body.modelId ?? MODEL,
        ...(body.effort !== undefined && { effort: body.effort }),
        ...(body.delivery !== undefined && { delivery: body.delivery }),
        message: {
          id: body.id ?? crypto.randomUUID(),
          parts: [{ type: 'text', text: body.text ?? 'queued' }],
        },
      });
  }

  function queue(
    chatId: string,
    body: Parameters<typeof send>[1] = {},
    cookie = cookieA,
  ) {
    return send(chatId, { delivery: 'queue', ...body }, cookie);
  }

  /** Poll a boolean condition with the shared `waitFor`. */
  const until = (what: string, condition: () => Promise<boolean>) =>
    waitFor(async () => ((await condition()) ? true : undefined), 20_000, what);

  const itemsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      tx.select().from(chatDeliveries).where(eq(chatDeliveries.chatId, chatId)),
    );

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userAId),
    );

  const messagesOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );

  const settle = (runId: string, status: TerminalRunStatus) =>
    executor.settleTerminalRun({ userId: userAId, runId, status });

  describe('seeded job notices', () => {
    async function seedNotice(chatId: string, jobChatId: string, seq = 7) {
      return tenantDb.runAs(userAId, async (tx) => {
        const jobs = new ChatJobsRepository(tx);

        const job = await jobs.insert(
          newChatJob({
            chatId: jobChatId,
            ownerUserId: userAId,
            seq,
            workerInstanceId: crypto.randomUUID(),
          }),
        );

        const settled = await jobs.settle(jobChatId, userAId, job.id, {
          state: 'failed',
        });

        if (!settled) throw new Error('Job fixture was not settled');

        const notice = await new ChatDeliveriesRepository(tx).insertJobNotice(
          settled,
        );

        if (!notice) throw new Error('Notice fixture was not inserted');

        if (chatId !== jobChatId) {
          // Keep the job reference but misbind the recipient Chat to exercise
          // the repository's owner/Chat defense against a forged notice row.
          const [forged] = await tx
            .update(chatDeliveries)
            .set({ chatId })
            .where(eq(chatDeliveries.id, notice.id))
            .returning();

          if (!forged) throw new Error('Forged notice fixture was not updated');

          return { job: settled, notice: forged };
        }

        return { job: settled, notice };
      });
    }

    it('rejects an owner send that reuses a job notice id without mutation', async () => {
      const chatId = await createChat();
      const { notice } = await seedNotice(chatId, chatId);
      const itemsBefore = await itemsOf(chatId);
      const runsBefore = await runsOf(chatId);
      const messagesBefore = await messagesOf(chatId);

      const response = await send(chatId, { id: notice.id });

      expect(response.status).toBe(409);
      expect(await itemsOf(chatId)).toEqual(itemsBefore);
      expect(await runsOf(chatId)).toEqual(runsBefore);
      expect(await messagesOf(chatId)).toEqual(messagesBefore);
    });

    it('inserts one notice per job and selects notices at the owner boundary', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { job, notice } = await seedNotice(chatId, chatId);

      const duplicate = await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).insertJobNotice(job),
      );

      const steerId = crypto.randomUUID();
      const queueId = crypto.randomUUID();
      await send(chatId, { delivery: 'steer', id: steerId });
      await send(chatId, { delivery: 'queue', id: queueId });

      const boundary = await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).lockPendingBoundary(chatId, userAId),
      );

      const signals = await tenantDb.runAs(userAId, async (tx) => ({
        pending: await new ChatDeliveriesRepository(tx).hasPendingSteering(
          chatId,
          userAId,
        ),
        end: await new ChatDeliveriesRepository(tx).stepEndSignal({
          chatId,
          runId,
          userId: userAId,
        }),
      }));

      expect(duplicate).toBeUndefined();
      expect(boundary.map(({ id }) => id)).toEqual([notice.id, steerId]);
      expect(boundary.map(({ mode }) => mode)).toEqual(['notice', 'steer']);
      expect(signals).toEqual({ pending: true, end: 'delivery' });
      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, state: 'pending', mode: 'notice' },
        { id: steerId, state: 'pending', mode: 'steer' },
        { id: queueId, state: 'pending', mode: 'queue' },
      ]);
    });

    it('consumes only settled job notices belonging to the requested owner and Chat', async () => {
      const chatId = await createChat();
      const otherChatId = await createChat();
      const runId = crypto.randomUUID();
      const local = await seedNotice(chatId, chatId);
      const foreignChat = await seedNotice(chatId, otherChatId);
      const ownerBChat = await createChat(userBId);

      const foreignOwner = await tenantDb.runAs(userBId, async (tx) => {
        const jobs = new ChatJobsRepository(tx);

        const job = await jobs.insert(
          newChatJob({
            chatId: ownerBChat,
            ownerUserId: userBId,
            seq: 9,
            workerInstanceId: crypto.randomUUID(),
          }),
        );

        const settled = await jobs.settle(ownerBChat, userBId, job.id, {
          state: 'failed',
        });

        if (!settled) throw new Error('Owner B job fixture was not settled');

        const notice = await new ChatDeliveriesRepository(tx).insertJobNotice(
          settled,
        );

        if (!notice) throw new Error('Owner B notice fixture was not inserted');

        return { job: settled, notice };
      });

      const consumed = await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).consumeJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          jobIds: [local.job.id, foreignChat.job.id, foreignOwner.job.id],
        }),
      );

      const foreignOwnerRows = await tenantDb.runAs(userBId, (tx) =>
        tx
          .select()
          .from(chatDeliveries)
          .where(eq(chatDeliveries.id, foreignOwner.notice.id)),
      );

      expect(foreignOwnerRows).toMatchObject([
        { state: 'pending', runId: null },
      ]);

      expect(consumed).toEqual([local.notice.id]);
      const targetRowsAfterConsume = await itemsOf(chatId);
      expect(
        targetRowsAfterConsume.find(({ id }) => id === local.notice.id),
      ).toMatchObject({ state: 'withdrawn', runId });
      expect(
        targetRowsAfterConsume.find(({ id }) => id === foreignChat.notice.id),
      ).toMatchObject({ state: 'pending', runId: null });

      await tenantDb.runAs(userAId, async (tx) => {
        await tx
          .update(chatDeliveries)
          .set({ state: 'withdrawn', runId })
          .where(eq(chatDeliveries.id, foreignChat.notice.id));
        await new ChatDeliveriesRepository(tx).restoreJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          deliveryIds: [foreignChat.notice.id],
        });
      });

      const foreignJobRow = (await itemsOf(chatId)).find(
        ({ id }) => id === foreignChat.notice.id,
      );

      expect(foreignJobRow).toMatchObject({
        state: 'withdrawn',
        runId,
      });

      await tenantDb.runAs(userBId, async (tx) => {
        await tx
          .update(chatDeliveries)
          .set({ state: 'withdrawn', runId })
          .where(eq(chatDeliveries.id, foreignOwner.notice.id));
      });
      await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).restoreJobNotices({
          chatId: ownerBChat,
          ownerUserId: userAId,
          runId,
          deliveryIds: [foreignOwner.notice.id],
        }),
      );

      const ownerBRows = await tenantDb.runAs(userBId, (tx) =>
        tx
          .select()
          .from(chatDeliveries)
          .where(eq(chatDeliveries.id, foreignOwner.notice.id)),
      );

      expect(ownerBRows).toMatchObject([{ state: 'withdrawn', runId }]);
    });

    it('lists only delivered job notices for the message in that owner Chat', async () => {
      const chatId = await createChat();
      const otherChatId = await createChat();
      const messageId = crypto.randomUUID();
      const local = await seedNotice(chatId, chatId);
      const otherChat = await seedNotice(otherChatId, otherChatId);
      const wrongMessage = await seedNotice(chatId, chatId, 8);
      await seedNotice(chatId, chatId, 9);
      await tenantDb.runAs(userAId, async (tx) => {
        const deliveries = new ChatDeliveriesRepository(tx);
        await deliveries.markDelivered(local.notice.id, userAId, {
          messageId,
          runId: crypto.randomUUID(),
        });
        await deliveries.markDelivered(otherChat.notice.id, userAId, {
          messageId,
          runId: crypto.randomUUID(),
        });
        await deliveries.markDelivered(wrongMessage.notice.id, userAId, {
          messageId: crypto.randomUUID(),
          runId: crypto.randomUUID(),
        });

        expect(
          (
            await deliveries.listDeliveredJobNotices(chatId, userAId, messageId)
          ).map(({ id }) => id),
        ).toEqual([local.notice.id]);
        expect(
          (
            await deliveries.listDeliveredJobNotices(
              otherChatId,
              userAId,
              messageId,
            )
          ).map(({ id }) => id),
        ).toEqual([otherChat.notice.id]);
        expect(
          await deliveries.listDeliveredJobNotices(chatId, userBId, messageId),
        ).toEqual([]);
      });
    });

    it('does not restore owner withdrawals or consumed notices with empty ids', async () => {
      const chatId = await createChat();
      const ownerWithdrawn = await seedNotice(chatId, chatId);
      const consumedNotice = await seedNotice(chatId, chatId, 8);
      const runId = crypto.randomUUID();
      await tenantDb.runAs(userAId, async (tx) => {
        const deliveries = new ChatDeliveriesRepository(tx);
        await deliveries.withdrawPending(
          chatId,
          ownerWithdrawn.notice.id,
          userAId,
        );

        const ids = await deliveries.consumeJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          jobIds: [ownerWithdrawn.job.id, consumedNotice.job.id],
        });

        expect(ids).toEqual([consumedNotice.notice.id]);
        await deliveries.restoreJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          deliveryIds: [ownerWithdrawn.notice.id],
        });
        await deliveries.restoreJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          deliveryIds: [],
        });
      });

      expect(await itemsOf(chatId)).toMatchObject([
        { id: ownerWithdrawn.notice.id, state: 'withdrawn', runId: null },
        { id: consumedNotice.notice.id, state: 'withdrawn', runId },
      ]);
    });

    it('restores only the settled notice consumed by this Run', async () => {
      const chatId = await createChat();
      const notice = await seedNotice(chatId, chatId);
      const runId = crypto.randomUUID();
      await tenantDb.runAs(userAId, async (tx) => {
        const deliveries = new ChatDeliveriesRepository(tx);

        const ids = await deliveries.consumeJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          jobIds: [notice.job.id],
        });

        expect(ids).toEqual([notice.notice.id]);
        await deliveries.restoreJobNotices({
          chatId,
          ownerUserId: userAId,
          runId,
          deliveryIds: ids,
        });
      });

      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.notice.id, state: 'pending', runId: null },
      ]);
    });

    it('lists a job locator and state, permits delete only, and never starts a Run', async () => {
      const chatId = await createChat();
      const { job, notice } = await seedNotice(chatId, chatId);
      const url = `/api/v1/chats/${chatId}/deliveries`;
      const listed = await request(http).get(url).set('Cookie', cookieA);
      const body: unknown = listed.body;

      expect(listed.status).toBe(200);
      expect(body).toMatchObject({
        items: [
          {
            id: notice.id,
            producer: 'job',
            mode: 'notice',
            job: 'job://bash-7',
            jobState: 'failed',
            parts: [],
          },
        ],
      });
      expect(JSON.stringify(body)).not.toContain(job.id);
      expect(JSON.stringify(body)).not.toContain(job.workerInstanceId);

      for (const mode of ['steer', 'interrupt']) {
        const changed = await request(http)
          .patch(`${url}/${notice.id}`)
          .set('Cookie', cookieA)
          .send({ mode });

        expect(changed.status).toBe(400);
      }

      expect(await runsOf(chatId)).toEqual([]);
      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, producer: 'job', mode: 'notice', state: 'pending' },
      ]);

      const removed = await request(http)
        .delete(`${url}/${notice.id}`)
        .set('Cookie', cookieA);

      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({
        producer: 'job',
        job: 'job://bash-7',
        jobState: 'failed',
        state: 'withdrawn',
      });
      expect(await itemsOf(chatId)).toMatchObject([{ state: 'withdrawn' }]);
      const after = await request(http).get(url).set('Cookie', cookieA);
      expect(after.body).toEqual({ items: [] });
    });

    it('refuses a notice mode change without expiring a stale Run', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { notice } = await seedNotice(chatId, chatId);
      await tenantDb.runAs(userAId, (tx) =>
        tx.execute(
          sql`UPDATE runs SET created_at = now() - interval '2 days', started_at = now() - interval '2 days' WHERE id = ${runId}`,
        ),
      );

      const before = await runsOf(chatId);

      const response = await request(http)
        .patch(`/api/v1/chats/${chatId}/deliveries/${notice.id}`)
        .set('Cookie', cookieA)
        .send({ mode: 'interrupt' });

      expect(response.status).toBe(400);
      expect(await runsOf(chatId)).toEqual(before);
      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, mode: 'notice', state: 'pending' },
      ]);
    });

    it('leaves a job notice pending when a failed Run pauses owner items', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { notice } = await seedNotice(chatId, chatId);

      await settle(runId, 'failed');

      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, producer: 'job', mode: 'notice', state: 'pending' },
      ]);
      expect(await runsOf(chatId)).toMatchObject([
        { id: runId, status: 'failed' },
      ]);
    });

    it('does not accept a notice as an owner send', async () => {
      const chatId = await createChat();
      const response = await send(chatId, { delivery: 'notice' });
      expect(response.status).toBe(400);
      expect(await itemsOf(chatId)).toEqual([]);
      expect(await runsOf(chatId)).toEqual([]);
    });

    it('hides job notices from other owners and a scope with no identity', async () => {
      const chatId = await createChat();
      const { notice } = await seedNotice(chatId, chatId);
      const url = `/api/v1/chats/${chatId}/deliveries`;
      const listed = await request(http).get(url).set('Cookie', cookieB);

      const removed = await request(http)
        .delete(`${url}/${notice.id}`)
        .set('Cookie', cookieB);

      const changed = await request(http)
        .patch(`${url}/${notice.id}`)
        .set('Cookie', cookieB)
        .send({ mode: 'steer' });

      expect([listed.status, removed.status, changed.status]).toEqual([
        404, 404, 404,
      ]);

      const withoutIdentity = await tenantDb.runAs(userAId, async (tx) => {
        await tx.execute(
          sql`select set_config('app.current_user_id', '', true)`,
        );

        return {
          visible: await new ChatDeliveriesRepository(tx).listPendingViews(
            chatId,
            userAId,
          ),
          changed: await tx
            .update(chatDeliveries)
            .set({ state: 'withdrawn' })
            .where(eq(chatDeliveries.id, notice.id))
            .returning(),
        };
      });

      expect(withoutIdentity).toEqual({ visible: [], changed: [] });
      expect(await itemsOf(chatId)).toMatchObject([{ state: 'pending' }]);
    });

    it('does not resolve a sender job in another Chat, even of the same owner', async () => {
      const chatId = await createChat();
      const jobChatId = await createChat();
      await seedNotice(chatId, jobChatId);

      const response = await request(http)
        .get(`/api/v1/chats/${chatId}/deliveries`)
        .set('Cookie', cookieA);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    });

    it('omits a malformed job reference without aborting the pending read', async () => {
      const chatId = await createChat();
      const { notice } = await seedNotice(chatId, chatId);
      await tenantDb.runAs(userAId, (tx) =>
        tx
          .update(chatDeliveries)
          .set({ senderRef: 'not-a-job-id' })
          .where(eq(chatDeliveries.id, notice.id)),
      );

      const response = await request(http)
        .get(`/api/v1/chats/${chatId}/deliveries`)
        .set('Cookie', cookieA);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    });

    it('keeps one notice per job after withdrawal', async () => {
      const chatId = await createChat();
      const { notice } = await seedNotice(chatId, chatId);
      await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).withdrawPending(
          chatId,
          notice.id,
          userAId,
        ),
      );

      const duplicate = await tenantDb
        .runAs(userAId, (tx) =>
          tx.insert(chatDeliveries).values({
            ...notice,
            id: crypto.randomUUID(),
            state: 'pending',
          }),
        )
        .catch((error: unknown) => error);

      expect(pgErrorCode(duplicate)).toBe('23505');
      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, state: 'withdrawn' },
      ]);
    });

    it('returns a notice when its receiving segment never dispatched', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { notice } = await seedNotice(chatId, chatId);

      const run = await tenantDb.runAs(userAId, async (tx) => {
        const runs = new RunsRepository(tx);
        const found = await runs.findById(runId, userAId);

        if (!found) throw new Error('seeded Run was not stored');

        await tx
          .update(chatDeliveries)
          .set({
            state: 'delivered',
            runId,
            deliveredMessageId: found.messageId,
          })
          .where(eq(chatDeliveries.id, notice.id));

        return found;
      });

      await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).returnUndispatchedJobNotices(run),
      );

      expect(await itemsOf(chatId)).toMatchObject([
        { id: notice.id, state: 'pending', deliveredMessageId: null },
      ]);
    });

    it('keeps a notice delivered after its receiving segment dispatched', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { notice } = await seedNotice(chatId, chatId);

      const run = await tenantDb.runAs(userAId, async (tx) => {
        const runs = new RunsRepository(tx);
        const events = new RunEventsRepository(tx);
        const found = await runs.findById(runId, userAId);

        if (!found) throw new Error('seeded Run was not stored');

        await events.append(runId, 'run.delivered', {
          messageId: found.messageId,
        });
        await events.append(runId, 'model.requested', { modelId: MODEL });
        await tx
          .update(chatDeliveries)
          .set({
            state: 'delivered',
            runId,
            deliveredMessageId: found.messageId,
          })
          .where(eq(chatDeliveries.id, notice.id));

        return found;
      });

      await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).returnUndispatchedJobNotices(run),
      );

      expect(await itemsOf(chatId)).toMatchObject([
        {
          id: notice.id,
          state: 'delivered',
          runId,
          deliveredMessageId: run.messageId,
        },
      ]);
    });

    it('does not restore a delivered notice owned by another user', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const { notice } = await seedNotice(chatId, chatId);

      const run = await tenantDb.runAs(userAId, async (tx) => {
        const found = await new RunsRepository(tx).findById(runId, userAId);

        if (!found) throw new Error('seeded Run was not stored');

        await tx
          .update(chatDeliveries)
          .set({
            state: 'delivered',
            runId,
            deliveredMessageId: found.messageId,
          })
          .where(eq(chatDeliveries.id, notice.id));

        return found;
      });

      await tenantDb.runAs(userBId, (tx) =>
        new ChatDeliveriesRepository(tx).returnUndispatchedJobNotices(run),
      );

      expect(await itemsOf(chatId)).toMatchObject([
        {
          id: notice.id,
          state: 'delivered',
          runId,
          deliveredMessageId: run.messageId,
        },
      ]);
    });
  });

  describe('admission', () => {
    it('A send with a delivery mode becomes a pending item during a live Run', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();

      const res = await queue(chatId, { id, text: 'then summarize' });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        id,
        chatId,
        mode: 'queue',
        state: 'pending',
        parts: [{ type: 'text', text: 'then summarize' }],
        modelId: MODEL,
        permissionMode: 'default',
      });
      // No Run and no message row: only the seeded Run and its message exist.
      expect(await runsOf(chatId)).toHaveLength(1);
      expect(await messagesOf(chatId)).toHaveLength(1);
    });

    it('An owner item names its producer', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });

      const [item] = await itemsOf(chatId);

      expect(item).toMatchObject({ id, producer: 'owner', senderRef: null });
    });

    it('A send without a delivery mode still gets 409', async () => {
      const { chatId } = await chatWithLiveRun();

      const res = await send(chatId, {});

      expect(res.status).toBe(409);
      expect(await itemsOf(chatId)).toEqual([]);
    });

    it.each(['later'])(
      'A delivery mode that this API does not accept (%s) gets 400',
      async (delivery) => {
        const { chatId } = await chatWithLiveRun();

        const res = await send(chatId, { delivery });

        expect(res.status).toBe(400);
        expect(await itemsOf(chatId)).toEqual([]);
      },
    );

    it('An invalid pending item writes nothing', async () => {
      const { chatId } = await chatWithLiveRun();

      const res = await queue(chatId, { modelId: 'system:openai:gone' });

      expect(res.status).toBe(422);
      expect(await itemsOf(chatId)).toEqual([]);
    });

    it('A delivery send to a Chat with a stuck Run', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      await tenantDb.runAs(userAId, (tx) =>
        tx.execute(
          sql`UPDATE runs SET created_at = now() - interval '2 days', started_at = now() - interval '2 days' WHERE id = ${runId}`,
        ),
      );

      const res = await queue(chatId);

      expect(res.status).toBe(200);
      const runs = await runsOf(chatId);
      expect(runs.find((run) => run.id === runId)?.status).toBe('expired');
      expect(runs).toHaveLength(2);
      expect(await itemsOf(chatId)).toEqual([]);
    });

    it('A queue send to an idle Chat starts at once', async () => {
      const chatId = await createChat();
      const id = crypto.randomUUID();

      const res = await queue(chatId, { id });

      expect(res.status).toBe(200);
      expect((await messagesOf(chatId)).some((m) => m.id === id)).toBe(true);
      expect(await runsOf(chatId)).toHaveLength(1);
      expect(await itemsOf(chatId)).toEqual([]);
    });

    it('A send to a paused queue goes first', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      await queue(chatId, { id: first });
      await queue(chatId, { id: second });
      // The Run ends without completing: the queue is paused.
      await settle(runId, 'cancelled');
      const fresh = crypto.randomUUID();
      models.client.delayMs = 300;

      const pendingSend = send(chatId, { id: fresh });
      const settled = pendingSend.then((res) => res);
      await until(
        'the fresh Run',
        async () => (await runsOf(chatId)).length === 2,
      );
      const states = (await itemsOf(chatId)).map((item) => item.state);
      const res = await settled;

      expect(res.status).toBe(200);
      expect(states).toEqual(['pending', 'pending']);
      const seeded = await messagesOf(chatId);
      expect(seeded.some((m) => m.id === fresh)).toBe(true);
    });

    it('A retried send returns the stored item', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();

      const first = await queue(chatId, { id });
      const second = await queue(chatId, { id });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body).toEqual(first.body);
      expect(await itemsOf(chatId)).toHaveLength(1);
    });

    it('The message id of a stored item in another Chat is a duplicate', async () => {
      const first = await chatWithLiveRun();
      const second = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(first.chatId, { id });

      const res = await queue(second.chatId, { id });

      expect(res.status).toBe(409);
      expect(await itemsOf(second.chatId)).toEqual([]);
    });
  });

  describe('message id collisions', () => {
    it('A plain send that repeats the id of a pending item answers the item', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      const stored = await queue(chatId, { id });

      const res = await send(chatId, { id });

      expect(res.status).toBe(202);
      expect(res.body).toEqual(stored.body);
      expect(await runsOf(chatId)).toHaveLength(1);
      expect(await itemsOf(chatId)).toHaveLength(1);
    });

    it('A plain send that repeats the id of an item in another Chat gets 409', async () => {
      const first = await chatWithLiveRun();
      const second = await createChat();
      const id = crypto.randomUUID();
      await queue(first.chatId, { id });

      const res = await send(second, { id });

      expect(res.status).toBe(409);
      expect(await runsOf(second)).toEqual([]);
    });

    it('A delivery send that repeats the id of a message in another Chat gets 409', async () => {
      const first = await createChat();
      const second = await chatWithLiveRun();
      const id = crypto.randomUUID();
      expect((await send(first, { id })).status).toBe(200);

      const res = await queue(second.chatId, { id });

      expect(res.status).toBe(409);
      expect(await itemsOf(second.chatId)).toEqual([]);
    });

    it('A stored item id is never stored twice', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();

      const insert = () =>
        tenantDb.runAs(userAId, (tx) =>
          new ChatDeliveriesRepository(tx).insertPending({
            id,
            chatId,
            ownerUserId: userAId,
            mode: 'queue',
            parts: [{ type: 'text', text: 'x' }],
            settings: { modelId: MODEL, permissionMode: 'default' },
          }),
        );

      const first = await insert();
      const second = await insert();

      expect(first?.id).toBe(id);
      expect(second).toBeUndefined();
      expect(await itemsOf(chatId)).toHaveLength(1);
    });
  });

  describe('the owner list and withdrawal', () => {
    it('lists the pending items in order and omits a withdrawn one', async () => {
      const { chatId } = await chatWithLiveRun();

      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];

      for (const id of ids) await queue(chatId, { id });
      await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${ids[1]}`)
        .set('Cookie', cookieA);

      const res = await request(http)
        .get(`/api/v1/chats/${chatId}/deliveries`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);

      const listed = z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(res.body);

      expect(listed.items.map((item) => item.id)).toEqual([ids[0], ids[2]]);
    });

    it('Withdraw returns the text for an edit', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id, text: 'fix this typo' });

      const res = await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${id}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        state: 'withdrawn',
        parts: [{ type: 'text', text: 'fix this typo' }],
      });
      // The Run completes and delivers nothing: no message, no Run.
      await settle(runId, 'completed');
      expect(await runsOf(chatId)).toHaveLength(1);
      expect(await messagesOf(chatId)).toHaveLength(1);
    });

    it('answers 404 for an item that is not in the Chat', async () => {
      const { chatId } = await chatWithLiveRun();

      const res = await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${crypto.randomUUID()}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
    });

    it('answers 409 for an item that is already withdrawn', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });
      const url = `/api/v1/chats/${chatId}/deliveries/${id}`;
      await request(http).delete(url).set('Cookie', cookieA);

      const again = await request(http).delete(url).set('Cookie', cookieA);

      expect(again.status).toBe(409);
    });
  });

  describe('tenancy', () => {
    it('Another owner cannot see or change an item', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });

      const list = await request(http)
        .get(`/api/v1/chats/${chatId}/deliveries`)
        .set('Cookie', cookieB);

      const withdraw = await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${id}`)
        .set('Cookie', cookieB);

      const inScopeOfB = await tenantDb.runAs(userBId, async (tx) => ({
        seen: await tx
          .select()
          .from(chatDeliveries)
          .where(eq(chatDeliveries.id, id)),
        changed: await tx
          .update(chatDeliveries)
          .set({ state: 'withdrawn' })
          .where(eq(chatDeliveries.id, id))
          .returning(),
      }));

      expect([list.status, withdraw.status]).toEqual([404, 404]);
      expect(inScopeOfB).toEqual({ seen: [], changed: [] });
      expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
        'pending',
      ]);
    });

    it('Another owner cannot add an item', async () => {
      const { chatId } = await chatWithLiveRun();

      const res = await queue(chatId, {}, cookieB);

      expect(res.status).toBe(404);
      expect(await itemsOf(chatId)).toEqual([]);
    });

    it('The datastore refuses a mismatched owner', async () => {
      const { chatId } = await chatWithLiveRun();

      const item = (ownerUserId: string) => ({
        id: crypto.randomUUID(),
        chatId,
        ownerUserId,
        mode: 'queue' as const,
        parts: [{ type: 'text', text: 'x' }],
        settings: { modelId: MODEL, permissionMode: 'default' as const },
      });

      // Owner B names the Chat of A: the composite key refuses it.
      const wrongChatOwner = pgErrorCode(
        await tenantDb
          .runAs(userBId, (tx) =>
            new ChatDeliveriesRepository(tx).insertPending(item(userBId)),
          )
          .catch((error: unknown) => error),
      );

      // Owner A written from the scope of B: row-level security refuses it.
      const wrongScope = pgErrorCode(
        await tenantDb
          .runAs(userBId, (tx) =>
            new ChatDeliveriesRepository(tx).insertPending(item(userAId)),
          )
          .catch((error: unknown) => error),
      );

      expect(wrongChatOwner).toBe('23503');
      expect(wrongScope).toBe('42501');
      expect(await itemsOf(chatId)).toEqual([]);
    });
  });

  describe('promotion on completion', () => {
    it('Three queue items run in order', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      models.client.responses = ['one', 'two', 'three'];

      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];

      await queue(chatId, {
        id: ids[0],
        modelId: SECOND_MODEL,
        effort: 'high',
      });
      await queue(chatId, { id: ids[1], modelId: THIRD_MODEL });
      await queue(chatId, { id: ids[2], modelId: MODEL });

      await settle(runId, 'completed');
      await until(
        'three replies',
        async () =>
          (await messagesOf(chatId)).filter((m) => m.role === 'assistant')
            .length === 3,
      );

      // A reply sits between every two items: item 2 started only after the
      // Run of item 1 completed.
      const transcript = await messagesOf(chatId);
      expect(transcript.slice(1).map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(
        transcript
          .filter((m) => m.role === 'user')
          .slice(1)
          .map((m) => m.id),
      ).toEqual(ids);
      const runs = (await runsOf(chatId)).filter((run) => run.id !== runId);
      expect(runs.map((run) => [run.modelId, run.effort, run.status])).toEqual([
        [SECOND_MODEL, 'high', 'completed'],
        [THIRD_MODEL, null, 'completed'],
        [MODEL, null, 'completed'],
      ]);
      expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
        'delivered',
        'delivered',
        'delivered',
      ]);
    });

    it('A promoted item keeps its id', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id, text: 'keep my id' });

      await settle(runId, 'completed');
      await until(
        'the promoted turn',
        async () => (await messagesOf(chatId)).length >= 3,
      );

      const message = (await messagesOf(chatId)).find((m) => m.id === id);
      expect(message?.role).toBe('user');
      // The worker stamps its context items beside the stored text.
      expect(message?.parts).toContainEqual({
        type: 'text',
        text: 'keep my id',
      });
      const [item] = await itemsOf(chatId);
      expect(item).toMatchObject({
        state: 'delivered',
        deliveredMessageId: id,
      });
    });

    it('A retry after delivery starts no Run', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });
      await settle(runId, 'completed');
      await until(
        'the promoted turn',
        async () => (await messagesOf(chatId)).length >= 3,
      );
      const runsBefore = await runsOf(chatId);

      const res = await queue(chatId, { id });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ id, state: 'delivered' });
      expect(await runsOf(chatId)).toHaveLength(runsBefore.length);
    });

    it('A withdrawal that loses the race to delivery', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });
      await settle(runId, 'completed');

      const res = await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${id}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(409);
      const [item] = await itemsOf(chatId);
      expect(item?.state).toBe('delivered');
      expect((await messagesOf(chatId)).some((m) => m.id === id)).toBe(true);
    });

    it('A withdrawal that arrives while the item is being promoted gets 409', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await queue(chatId, { id });
      let withdrawal: Promise<{ status: number }> | undefined;

      // The promotion has read the item and holds it; the withdrawal comes now.
      const markDelivered = vi.spyOn(
        ChatDeliveriesRepository.prototype,
        'markDelivered',
      );

      markDelivered.mockImplementationOnce(async function (
        this: ChatDeliveriesRepository,
        ...args: Parameters<ChatDeliveriesRepository['markDelivered']>
      ) {
        withdrawal = request(http)
          .delete(`/api/v1/chats/${chatId}/deliveries/${id}`)
          .set('Cookie', cookieA)
          .then((res) => res);
        await new Promise((resolve) => setTimeout(resolve, 500));
        markDelivered.mockRestore();

        return this.markDelivered(...args);
      });

      await settle(runId, 'completed');
      const res = await withdrawal;

      expect(res?.status).toBe(409);
      await until('the promoted reply', async () =>
        (await messagesOf(chatId)).some((m) => m.role === 'assistant'),
      );
      expect(
        (await messagesOf(chatId)).filter((m) => m.role === 'user'),
      ).toHaveLength(2);
      expect(await runsOf(chatId)).toHaveLength(2);
      expect((await itemsOf(chatId))[0]?.state).toBe('delivered');
    });

    it('An item of an archived Chat stays pending', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      await queue(chatId, {});
      await tenantDb.runAs(userAId, (tx) =>
        tx.execute(
          sql`UPDATE chats SET archived_at = now() WHERE id = ${chatId}`,
        ),
      );

      await settle(runId, 'completed');

      expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
        'pending',
      ]);
      expect(await runsOf(chatId)).toHaveLength(1);
    });

    it('A completed follow-up Run promotes the first item too', async () => {
      const { chatId, runId } = await chatWithLiveRun({ followUp: true });
      const id = crypto.randomUUID();
      await queue(chatId, { id });

      await settle(runId, 'completed');
      await until('the promoted Run', async () =>
        (await runsOf(chatId)).some((run) => run.messageId === id),
      );

      expect((await itemsOf(chatId))[0]?.state).toBe('delivered');
    });

    it('A queue item that a send cannot use stays pending', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      await queue(chatId, { text: 'first' });
      await queue(chatId, { text: 'second' });
      // The model of both items leaves the catalog before the Run completes.
      vi.spyOn(models, 'validateModelSelection').mockImplementation(
        (modelId) => {
          throw new ModelNotAvailableError(modelId);
        },
      );

      await settle(runId, 'completed');

      expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
        'pending',
        'pending',
      ]);
      expect(await runsOf(chatId)).toHaveLength(1);
    });

    it('A queue item whose permission mode is disabled now stays pending', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      await tenantDb.runAs(userAId, async (tx) => {
        await new ChatDeliveriesRepository(tx).insertPending({
          id: crypto.randomUUID(),
          chatId,
          ownerUserId: userAId,
          mode: 'queue',
          parts: [{ type: 'text', text: 'bypass' }],
          settings: { modelId: MODEL, permissionMode: 'bypass' },
        });
      });

      await settle(runId, 'completed');

      expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
        'pending',
      ]);
      expect(await runsOf(chatId)).toHaveLength(1);
    });

    it.each(['failed', 'cancelled', 'expired'] as const)(
      'A %s Run pauses the queue',
      async (status) => {
        const { chatId, runId } = await chatWithLiveRun();
        await queue(chatId, { text: 'one' });
        await queue(chatId, { text: 'two' });

        await settle(runId, status);

        expect((await itemsOf(chatId)).map((item) => item.state)).toEqual([
          'pending',
          'pending',
        ]);
        expect(await runsOf(chatId)).toHaveLength(1);
      },
    );
  });
});
