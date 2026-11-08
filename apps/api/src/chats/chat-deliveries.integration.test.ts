/**
 * run-steering, `queue` layer — real HTTP + Postgres (RLS active) + the
 * co-located worker, with the fake model client: the pending items a send
 * stores while a Run is live, the owner's list and withdrawal, tenant
 * isolation, and the promotion of a queue item when a Run completes.
 *
 * A live Run is seeded through the repositories: with no queue job and a fresh
 * `created_at`, admission judges it live, as it would a Run that executes.
 *
 * POSTGRES_URL-gated; run by `test:integration`.
 */

import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { isRecord, isString } from '@workspace/runtime-safety';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { chatDeliveries } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { type TerminalRunStatus } from '../runs/run-status';
import { RunsRepository } from '../runs/runs-repository';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const d = process.env.POSTGRES_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

const MODEL = 'system:openai:gpt-5.5';
const SECOND_MODEL = 'system:openai:gpt-5.4';
const THIRD_MODEL = 'system:openai:gpt-5.4-mini';

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The Postgres error code under a Drizzle query error. */
async function pgErrorCode(
  attempt: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return isRecord(error) &&
      isRecord(error.cause) &&
      isString(error.cause.code)
      ? error.cause.code
      : undefined;
  }
  return undefined;
}

d('chat deliveries — the queue mode', () => {
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

    it.each(['steer', 'interrupt', 'later'])(
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
      await waitFor(async () => (await runsOf(chatId)).length === 2);
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
      const wrongChatOwner = await pgErrorCode(
        tenantDb.runAs(userBId, (tx) =>
          new ChatDeliveriesRepository(tx).insertPending(item(userBId)),
        ),
      );
      // Owner A written from the scope of B: row-level security refuses it.
      const wrongScope = await pgErrorCode(
        tenantDb.runAs(userBId, (tx) =>
          new ChatDeliveriesRepository(tx).insertPending(item(userAId)),
        ),
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
      await waitFor(
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
      await waitFor(async () => (await messagesOf(chatId)).length >= 3);

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
      await waitFor(async () => (await messagesOf(chatId)).length >= 3);
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

    it('A completed follow-up Run promotes the first item too', async () => {
      const { chatId, runId } = await chatWithLiveRun({ followUp: true });
      const id = crypto.randomUUID();
      await queue(chatId, { id });

      await settle(runId, 'completed');
      await waitFor(async () =>
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
