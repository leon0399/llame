/**
 * run-steering, `steer` layer — real HTTP + Postgres (RLS active) + the
 * co-located worker, with the fake model client: `delivery: "steer"` admission,
 * the mode change on a pending item (live Run and paused queue), and the queue
 * that pauses behind a Run that does not complete.
 *
 * A live Run is seeded through the repositories, as in
 * `chat-deliveries.integration.test.ts`: with no queue job and a fresh
 * `created_at`, admission judges it live.
 *
 * Needs TEST_DATABASE_URL; run by `test:integration`.
 */

import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import {
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { deadLetterQueue } from '../queue/queue';
import {
  RunAbortRegistry,
  type SegmentControl,
} from '../runs/run-abort-registry';
import { RunExecutionService } from '../runs/run-execution.service';
import { RUNS_QUEUE, type RunJob } from '../runs/run-queues';
import { RunsWorkerService } from '../runs/runs-worker.service';
import { type TerminalRunStatus } from '../runs/run-status';
import { latestDeliverySequence } from '../runs/run-segment-queries';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
  waitFor,
} from '../testing/support';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from './chats-repository';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'chat-steering.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 60_000 });

const MODEL = 'system:openai:gpt-5.5';

const itemsBody = z.object({
  items: z.array(z.object({ id: z.string(), mode: z.string() })),
});

describe('chat deliveries — the steer mode', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;
  let executor: RunExecutionService;

  const tag = Date.now();
  let cookieA = '';
  let userAId = '';
  let cookieB = '';

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

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    executor = app.get(RunExecutionService, { strict: false });
    const userA = await register(`steering-a-${tag}@example.com`, 'A');
    cookieA = userA.cookie;
    userAId = userA.userId;
    cookieB = (await register(`steering-b-${tag}@example.com`, 'B')).cookie;
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

  async function createChat(): Promise<string> {
    const chat = await tenantDb.runAs(userAId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userAId, title: 'Steer' }),
    );

    return chat.id;
  }

  /** A Chat with one Run that a send judges live. */
  async function chatWithLiveRun(): Promise<{
    chatId: string;
    runId: string;
    messageId: string;
  }> {
    const chatId = await createChat();

    return tenantDb.runAs(userAId, async (tx) => {
      const message = await new MessagesRepository(
        tx,
      ).createUserMessageIfAbsent({
        id: crypto.randomUUID(),
        chatId,
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'seed' }],
      });

      if (!message) throw new Error('seed message not stored');
      const runs = new RunsRepository(tx);

      const run = await runs.create({
        chatId,
        messageId: message.id,
        userId: userAId,
        modelId: MODEL,
      });

      await runs.markStarted(run.id, userAId);

      return { chatId, runId: run.id, messageId: message.id };
    });
  }

  function send(
    chatId: string,
    body: { id?: string; text?: string; modelId?: string; delivery?: string },
  ) {
    return request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: body.modelId ?? MODEL,
        ...(body.delivery !== undefined && { delivery: body.delivery }),
        message: {
          id: body.id ?? crypto.randomUUID(),
          parts: [{ type: 'text', text: body.text ?? 'steer' }],
        },
      });
  }

  const sendMode = (
    chatId: string,
    mode: 'queue' | 'steer' | 'interrupt',
    body: Parameters<typeof send>[1] = {},
  ) => send(chatId, { delivery: mode, ...body });

  function change(chatId: string, id: string, mode: string, cookie = cookieA) {
    return request(http)
      .patch(`/api/v1/chats/${chatId}/deliveries/${id}`)
      .set('Cookie', cookie)
      .send({ mode });
  }

  /** The pending items in delivery order, as the owner lists them. */
  async function pending(
    chatId: string,
  ): Promise<Array<{ id: string; mode: string }>> {
    const res = await request(http)
      .get(`/api/v1/chats/${chatId}/deliveries`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);

    return itemsBody.parse(res.body).items;
  }

  const modesOf = async (chatId: string) =>
    (await pending(chatId)).map((item) => [item.id, item.mode]);

  const until = (what: string, condition: () => Promise<boolean>) =>
    waitFor(async () => ((await condition()) ? true : undefined), 20_000, what);

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userAId),
    );

  const messagesOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );

  /**
   * The handler a `runs` worker registers on the `runs.dead` queue, real
   * executor and tenant scope behind it; the queue only captures it.
   */
  async function deadLetterConsumer(): Promise<(job: RunJob) => Promise<void>> {
    let handler: ((job: RunJob) => Promise<void>) | undefined;

    const consume = vi
      .fn<
        (
          queue: { name: string },
          consumer: (job: RunJob) => Promise<void>,
        ) => Promise<string>
      >()
      .mockImplementation((definition, consumer) => {
        if (definition.name === deadLetterQueue(RUNS_QUEUE).name) {
          handler = consumer;
        }

        return Promise.resolve('consumer-id');
      });

    await new RunsWorkerService(
      { ensureQueue: () => Promise.resolve(), consume },
      app.get(InstanceConfigService, { strict: false }),
      { concurrencyFor: () => 1 },
      { assertReady: () => Promise.resolve() },
      models,
      executor,
      tenantDb,
      app.get(RunAbortRegistry, { strict: false }),
    ).onApplicationBootstrap();

    if (!handler) throw new Error('runs.dead consumer not registered');

    return handler;
  }

  const settle = (
    runId: string,
    status: TerminalRunStatus,
    extra: { error?: unknown; runPayload?: unknown } = {},
  ) => executor.settleTerminalRun({ userId: userAId, runId, status, ...extra });

  /**
   * A Run this process executes, with a model call in flight for an attempt it
   * names, so the run-control signal has a segment to stop.
   */
  async function executingRun(runId: string): Promise<SegmentControl> {
    const attemptId = crypto.randomUUID();
    await tenantDb.runAs(userAId, (tx) =>
      tx.execute(
        sql`UPDATE runs SET active_attempt_id = ${attemptId} WHERE id = ${runId}`,
      ),
    );
    const aborts = app.get(RunAbortRegistry, { strict: false });
    aborts.register(runId, userAId);
    const segment = aborts.beginSegment(runId, attemptId);

    if (!segment) throw new Error('the Run has no segment');

    return segment;
  }

  const stopped = (segment: SegmentControl) =>
    until('the interrupt to stop the segment', () =>
      Promise.resolve(segment.abort.signal.aborted),
    );

  describe('admission', () => {
    it('An interrupt during a Run is accepted and stops the segment in flight', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const segment = await executingRun(runId);
      const id = crypto.randomUUID();

      const res = await sendMode(chatId, 'interrupt', { id, text: 'stop' });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        id,
        mode: 'interrupt',
        state: 'pending',
      });
      await stopped(segment);
      expect(await runsOf(chatId)).toHaveLength(1);
    });

    it('A steer during a Run is accepted as a pending item', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();

      const res = await sendMode(chatId, 'steer', { id, text: 'also this' });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        id,
        mode: 'steer',
        state: 'pending',
        parts: [{ type: 'text', text: 'also this' }],
      });
      expect(await runsOf(chatId)).toHaveLength(1);
      expect(await messagesOf(chatId)).toHaveLength(1);
    });

    it('A steer after completion starts a Run', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      await settle(runId, 'completed');
      const id = crypto.randomUUID();

      const res = await sendMode(chatId, 'steer', { id });

      expect(res.status).toBe(200);
      expect((await messagesOf(chatId)).some((m) => m.id === id)).toBe(true);
      expect(await runsOf(chatId)).toHaveLength(2);
      expect(await pending(chatId)).toEqual([]);
    });

    it('A retry after delivery starts no Run', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'steer', { id });
      // The delivery of the item, as the step end of the Run records it.
      await tenantDb.runAs(userAId, async (tx) => {
        const message = await new MessagesRepository(
          tx,
        ).createUserMessageIfAbsent({
          id,
          chatId,
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'steer' }],
        });

        await new ChatDeliveriesRepository(tx).markDelivered(id, userAId, {
          messageId: message?.id ?? id,
          runId,
        });
      });
      await settle(runId, 'completed');
      const runsBefore = await runsOf(chatId);

      const res = await sendMode(chatId, 'steer', { id });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ id, state: 'delivered' });
      expect(await runsOf(chatId)).toHaveLength(runsBefore.length);
    });

    it('An item id from another Chat is a duplicate', async () => {
      const first = await chatWithLiveRun();
      const second = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(first.chatId, 'steer', { id });

      const res = await sendMode(second.chatId, 'steer', { id });

      expect(res.status).toBe(409);
      expect(await pending(second.chatId)).toEqual([]);
    });
  });

  describe('a mode change', () => {
    it('Steer now changes a queue item', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id });

      const res = await change(chatId, id, 'steer');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, mode: 'steer', state: 'pending' });

      // The next step end of the Run finds it.
      const signal = await tenantDb.runAs(userAId, (tx) =>
        new ChatDeliveriesRepository(tx).stepEndSignal({
          runId,
          chatId,
          userId: userAId,
        }),
      );

      expect(signal).toBe('delivery');
    });

    it('Interrupt now changes a steer item and stops the segment in flight', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const segment = await executingRun(runId);
      const id = crypto.randomUUID();
      await sendMode(chatId, 'steer', { id });

      const res = await change(chatId, id, 'interrupt');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        mode: 'interrupt',
        state: 'pending',
      });
      await stopped(segment);
    });

    it('Interrupt now on a paused item starts a Run like a steer', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id });
      await settle(runId, 'failed', { error: { message: 'boom' } });
      models.client.delayMs = 300;

      const res = await change(chatId, id, 'interrupt');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, state: 'delivered' });
      expect(await runsOf(chatId)).toHaveLength(2);
      expect(await pending(chatId)).toEqual([]);
    });

    it('A change that expires a stuck Run keeps the item a steer', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id });
      await tenantDb.runAs(userAId, (tx) =>
        tx.execute(
          sql`UPDATE runs SET created_at = now() - interval '2 days', started_at = now() - interval '2 days' WHERE id = ${runId}`,
        ),
      );
      models.client.delayMs = 300;

      const res = await change(chatId, id, 'steer');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, mode: 'steer', state: 'delivered' });
      expect(await runsOf(chatId)).toHaveLength(2);
    });

    it.each(['queue', 'later'])(
      'A change to %s gets 400 and changes nothing',
      async (mode) => {
        const { chatId } = await chatWithLiveRun();
        const id = crypto.randomUUID();
        await sendMode(chatId, 'queue', { id });

        const res = await change(chatId, id, mode);

        expect(res.status).toBe(400);
        expect(await modesOf(chatId)).toEqual([[id, 'queue']]);
      },
    );

    it('An item of another owner or Chat is not found', async () => {
      const first = await chatWithLiveRun();
      const other = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(first.chatId, 'queue', { id });

      expect((await change(first.chatId, id, 'steer', cookieB)).status).toBe(
        404,
      );
      expect((await change(other.chatId, id, 'steer')).status).toBe(404);
      expect(
        (await change(first.chatId, crypto.randomUUID(), 'steer')).status,
      ).toBe(404);
      expect(await modesOf(first.chatId)).toEqual([[id, 'queue']]);
    });

    it.each(['live Run', 'paused queue'])(
      'An archived Chat with a %s: the change answers 409 and the item keeps queue',
      async (state) => {
        const { chatId, runId } = await chatWithLiveRun();
        const id = crypto.randomUUID();
        await sendMode(chatId, 'queue', { id });

        if (state === 'paused queue') {
          await settle(runId, 'failed', { error: { message: 'boom' } });
        }

        await tenantDb.runAs(userAId, (tx) =>
          tx.execute(
            sql`UPDATE chats SET archived_at = now() WHERE id = ${chatId}`,
          ),
        );

        const res = await change(chatId, id, 'steer');

        expect(res.status).toBe(409);
        expect(await modesOf(chatId)).toEqual([[id, 'queue']]);
        expect(await runsOf(chatId)).toHaveLength(1);
      },
    );

    it('An item that is no longer pending gets 409', async () => {
      const { chatId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id });
      await request(http)
        .delete(`/api/v1/chats/${chatId}/deliveries/${id}`)
        .set('Cookie', cookieA);

      expect((await change(chatId, id, 'steer')).status).toBe(409);
    });

    it('Steer now on a paused item', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id: first });
      await sendMode(chatId, 'queue', { id: second, text: 'second' });
      await settle(runId, 'failed', { error: { message: 'boom' } });
      expect(await pending(chatId)).toHaveLength(2);
      models.client.delayMs = 500;

      const res = await change(chatId, second, 'steer');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: second, state: 'delivered' });
      const runs = await runsOf(chatId);
      expect(runs).toHaveLength(2);
      expect(runs.some((run) => run.messageId === second)).toBe(true);
      expect((await messagesOf(chatId)).some((m) => m.id === second)).toBe(
        true,
      );
      // The first item stays behind until the Run of the second completes.
      expect(await modesOf(chatId)).toEqual([[first, 'queue']]);
      expect(runs.some((run) => run.messageId === first)).toBe(false);
      await until(
        'the first item, promoted by the completed Run',
        async () => (await pending(chatId)).length === 0,
      );
    });

    it('Steer now on a paused item with settings a send cannot use', async () => {
      const { chatId, runId } = await chatWithLiveRun();
      const id = crypto.randomUUID();
      await sendMode(chatId, 'queue', { id });
      await settle(runId, 'failed', { error: { message: 'boom' } });
      vi.spyOn(models, 'validateModelSelection').mockImplementation(
        (modelId) => {
          throw new ModelNotAvailableError(modelId);
        },
      );

      const res = await change(chatId, id, 'steer');

      expect(res.status).toBe(422);
      expect(await modesOf(chatId)).toEqual([[id, 'queue']]);
      expect(await runsOf(chatId)).toHaveLength(1);
      expect((await messagesOf(chatId)).some((m) => m.id === id)).toBe(false);
    });
  });

  describe('the queue pauses behind a Run that does not complete', () => {
    /** A steer sent last, behind two queue items: it must come out first. */
    async function liveRunWithThreeItems() {
      const run = await chatWithLiveRun();

      const ids = {
        one: crypto.randomUUID(),
        two: crypto.randomUUID(),
        steer: crypto.randomUUID(),
      };

      await sendMode(run.chatId, 'queue', { id: ids.one });
      await sendMode(run.chatId, 'queue', { id: ids.two });
      await sendMode(run.chatId, 'steer', { id: ids.steer });

      return { ...run, ids };
    }

    const pausedOrder = (ids: { one: string; two: string; steer: string }) => [
      [ids.steer, 'queue'],
      [ids.one, 'queue'],
      [ids.two, 'queue'],
    ];

    it.each(['failed', 'cancelled', 'expired'] as const)(
      'A %s Run pauses the queue',
      async (status) => {
        const { chatId, runId, ids } = await liveRunWithThreeItems();

        await settle(runId, status, { error: { message: status } });

        expect(await modesOf(chatId)).toEqual(pausedOrder(ids));
        expect(await runsOf(chatId)).toHaveLength(1);
      },
    );

    it('A dead-letter expiry pauses the queue', async () => {
      const { chatId, runId, ids } = await liveRunWithThreeItems();

      const expireDeadLettered = await deadLetterConsumer();
      await expireDeadLettered({
        runId,
        chatId,
        userId: userAId,
        modelId: MODEL,
        userMessage: { id: crypto.randomUUID(), seq: 1, parts: [] },
      });

      expect(await modesOf(chatId)).toEqual(pausedOrder(ids));
    });

    it('An admission expiry pauses the queue', async () => {
      const { chatId, runId, ids } = await liveRunWithThreeItems();
      await tenantDb.runAs(userAId, (tx) =>
        tx.execute(
          sql`UPDATE runs SET created_at = now() - interval '2 days', started_at = now() - interval '2 days' WHERE id = ${runId}`,
        ),
      );
      models.client.delayMs = 300;

      const fresh = send(chatId, {}).then((res) => res);
      await until(
        'the fresh Run',
        async () => (await runsOf(chatId)).length === 2,
      );
      const order = await modesOf(chatId);
      const res = await fresh;

      expect(res.status).toBe(200);
      expect(order).toEqual(pausedOrder(ids));
    });

    it('A Run that completes with a recorded cancellation pauses the queue and promotes nothing', async () => {
      const { chatId, runId, ids } = await liveRunWithThreeItems();
      await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).requestCancel(runId, userAId),
      );

      await settle(runId, 'completed');

      expect(await modesOf(chatId)).toEqual(pausedOrder(ids));
      expect(await runsOf(chatId)).toHaveLength(1);
    });

    it('A superseded Run pauses the queue', async () => {
      const { chatId, messageId, ids } = await liveRunWithThreeItems();

      await tenantDb.runAs(userAId, (tx) =>
        new RunsRepository(tx).cancelActiveRunsForMessage(messageId, userAId),
      );

      expect(await modesOf(chatId)).toEqual(pausedOrder(ids));
    });
  });

  describe('the stream of a Run that delivered', () => {
    it('A resume after a delivery replays only the current segment', async () => {
      const { runId } = await chatWithLiveRun();

      const sequences = await tenantDb.runAs(userAId, async (tx) => {
        const events = new RunEventsRepository(tx);
        const before = await latestDeliverySequence(tx, runId, userAId);
        await events.append(runId, 'model.delta', { text: 'first segment' });

        const delivered = await events.append(runId, 'run.delivered', {
          messageId: crypto.randomUUID(),
        });

        await events.append(runId, 'model.delta', { text: 'second segment' });

        return {
          before,
          delivered: delivered.sequence,
          after: await latestDeliverySequence(tx, runId, userAId),
        };
      });

      // No delivery replays from the start; one delivery moves the cursor to
      // it, so the resume streams only what follows.
      expect(sequences.before).toBe(0);
      expect(sequences.after).toBe(sequences.delivered);
    });
  });
});
