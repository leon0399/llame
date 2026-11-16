/**
 * Idle `/compact` admission over real HTTP and Postgres, with the fake model client.
 * The database suite runs in CI; it is skipped locally when POSTGRES_URL is absent.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql as dsql } from 'drizzle-orm';
import type { Server } from 'node:http';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { TenantDbService } from '../db/tenant-db.service';
import type { Message } from '../db/schema';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { createCompactionCheckpointPart } from './context-item-producers';
import { ModelsService } from '../models/models.service';
import { RunDispatchService } from '../runs/run-dispatch.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;
const MODEL_ID = 'system:openai:gpt-5.4-mini';

vi.setConfig({ testTimeout: 30_000 });

d('POST /api/v1/chats/:id/messages — idle compaction admission', () => {
  let app: INestApplication;
  let http: Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;
  const tag = Date.now();
  const password = 'password123';
  let cookieA = '';
  let userAId = '';
  let cookieB = '';
  let releaseHeldTurn: (() => void) | undefined;

  async function register(email: string, name: string) {
    const response = await request(http)
      .post('/auth/v1/register')
      .send({ email, password, name });

    expect(response.status).toBe(201);
    const body: unknown = response.body;
    expectRegisteredUserId(body);

    return { cookie: cookieOf(response), userId: body.user.id };
  }

  async function createChat(ownerUserId: string, title: string) {
    const chat = await tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId, title }),
    );

    return chat.id;
  }

  async function seedOneTurn(
    chatId: string,
    ownerUserId: string,
    turnCount = 1,
  ) {
    return tenantDb.runAs(ownerUserId, async (tx) => {
      const messages = new MessagesRepository(tx);
      let user: Message | undefined;
      let assistant: Message | undefined;

      for (let index = 0; index < turnCount; index += 1) {
        user = await messages.create({
          chatId,
          role: 'user',
          senderUserId: ownerUserId,
          parts: [{ type: 'text', text: `Keep migration plan ${index + 1}.` }],
          attachments: [],
        });
        assistant = await messages.create({
          chatId,
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'Keep the rollout safe.' }],
          attachments: [],
        });
      }

      if (!user || !assistant) throw new Error('Expected one seeded turn.');

      return { user, assistant };
    });
  }

  async function listMessages(chatId: string, ownerUserId: string) {
    return tenantDb.runAs(ownerUserId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, ownerUserId),
    );
  }

  function pauseRunDispatch() {
    vi.spyOn(app.get(RunDispatchService), 'dispatch').mockResolvedValue();
  }

  function sendCompact(
    chatId: string,
    options: {
      cookie?: string;
      modelId?: string;
      delivery?: 'queue' | 'steer' | 'interrupt';
      messageId?: string;
      text?: string;
    } = {},
  ) {
    const cookie = options.cookie ?? cookieA;

    return request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: options.modelId ?? MODEL_ID,
        ...(options.delivery !== undefined && { delivery: options.delivery }),
        message: {
          id: options.messageId ?? crypto.randomUUID(),
          parts: [{ type: 'text', text: options.text ?? '/compact' }],
        },
      });
  }

  function holdNextTurn() {
    const held = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    releaseHeldTurn = held.resolve;

    const original: typeof models.client.streamText =
      models.client.streamText.bind(models.client);

    const spy = vi.spyOn(models.client, 'streamText');
    spy.mockImplementation((input) => {
      const onFinish = input.onFinish;

      if (!onFinish) return original(input);
      spy.mockRestore();

      return original({
        ...input,
        onFinish: async (output) => {
          started.resolve();
          await held.promise;
          await onFinish(output);
        },
      });
    });

    return { started: started.promise };
  }

  beforeAll(async () => {
    models = new FakeModelsService();

    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = testingModule.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    const ownerA = await register(`compact-a-${tag}@example.com`, 'Compact A');
    cookieA = ownerA.cookie;
    userAId = ownerA.userId;
    const ownerB = await register(`compact-b-${tag}@example.com`, 'Compact B');
    cookieB = ownerB.cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    models.credential = 'sk-test';
    models.createClientCalls.length = 0;
    models.client.turns.length = 0;
    models.client.responses = ['fake assistant'];
    models.client.usage = {
      inputTokens: 3,
      inputTokenDetails: {
        noCacheTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
      },
      cachedInputTokens: 2,
      outputTokens: 5,
      outputTokenDetails: { textTokens: 4, reasoningTokens: 1 },
      totalTokens: 8,
      reasoningTokens: 1,
    };
    models.client.delayMs = 0;
    releaseHeldTurn = undefined;
  });

  it('Compact starts a Run', async () => {
    const chatId = await createChat(userAId, 'Compaction admission');
    const { user, assistant } = await seedOneTurn(chatId, userAId, 5);
    const before = await listMessages(chatId, userAId);
    pauseRunDispatch();

    const response = await sendCompact(chatId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      type: 'command',
      command: 'compact',
    });

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    if (!run) throw new Error('Expected a compaction Run.');

    const events = await tenantDb.runAs(userAId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userAId),
    );

    expect(run).toMatchObject({
      id: run.id,
      kind: 'compaction',
      messageId: null,
      followUpAction: null,
      modelId: MODEL_ID,
    });
    expect(events[0]).toMatchObject({
      eventType: 'run.created',
      payload: {
        chatId,
        messageId: null,
        compaction: { focus: null },
      },
    });
    await expect(listMessages(chatId, userAId)).resolves.toEqual(
      expect.arrayContaining([user, assistant]),
    );
    expect(await listMessages(chatId, userAId)).toHaveLength(before.length);
  });

  it('Compact after a stuck Run', async () => {
    const chatId = await createChat(userAId, 'Stuck Run compaction');
    await seedOneTurn(chatId, userAId);
    const stuckRunId = crypto.randomUUID();
    await tenantDb.runAs(userAId, async (tx) => {
      await new RunsRepository(tx).create({
        id: stuckRunId,
        chatId,
        messageId: null,
        userId: userAId,
        modelId: MODEL_ID,
      });
      await tx.execute(
        dsql`UPDATE runs SET created_at = now() - interval '1 hour' WHERE id = ${stuckRunId}`,
      );
    });
    pauseRunDispatch();

    const response = await sendCompact(chatId);

    const expired = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findById(stuckRunId, userAId),
    );

    expect(response.status).toBe(200);
    expect(expired?.status).toBe('expired');

    const latest = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(latest?.id).not.toBe(stuckRunId);
  });

  it('A compact with an unknown model', async () => {
    const chatId = await createChat(userAId, 'Unknown compaction model');
    await seedOneTurn(chatId, userAId);

    const response = await sendCompact(chatId, { modelId: 'not-a-chat-model' });

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(422);
    expect(run).toBeUndefined();
  });

  it('An empty Chat', async () => {
    const chatId = await createChat(userAId, 'Empty Chat');
    const response = await sendCompact(chatId);

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      message: expect.stringContaining('Nothing to compact.'),
    });
    expect(run).toBeUndefined();
  });

  it('A second compact with no new turn', async () => {
    const chatId = await createChat(userAId, 'Already compacted');
    const { assistant } = await seedOneTurn(chatId, userAId);
    await tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).createCheckpoint({
        chatId,
        absorbedThroughSeq: assistant.seq,
        part: createCompactionCheckpointPart('Migration plan.'),
        usage: { inputTokens: 2, outputTokens: 1, modelId: MODEL_ID },
      }),
    );

    const response = await sendCompact(chatId);

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      message: expect.stringContaining('Nothing to compact.'),
    });
    expect(run).toBeUndefined();
  });

  it('A short Chat compacts', async () => {
    const chatId = await createChat(userAId, 'One turn');
    await seedOneTurn(chatId, userAId);
    pauseRunDispatch();

    const response = await sendCompact(chatId);

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(200);
    expect(run).toMatchObject({ kind: 'compaction', messageId: null });
  });

  it('A compact on an archived Chat', async () => {
    const chatId = await createChat(userAId, 'Archived Chat');
    await seedOneTurn(chatId, userAId);
    await tenantDb.runAs(userAId, (tx) =>
      new ChatsRepository(tx).update(chatId, userAId, { archived: true }),
    );

    const response = await sendCompact(chatId);

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(409);
    expect(run).toBeUndefined();
  });

  it("Another owner's Chat reveals nothing for /compact", async () => {
    const chatId = await createChat(userAId, 'Private Chat');
    await seedOneTurn(chatId, userAId);
    const before = await listMessages(chatId, userAId);
    const response = await sendCompact(chatId, { cookie: cookieB });

    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findLatestByChatId(chatId, userAId),
    );

    expect(response.status).toBe(404);
    expect(run).toBeUndefined();
    await expect(listMessages(chatId, userAId)).resolves.toEqual(before);
  });

  it('Compact during a Run without a delivery mode', async () => {
    const chatId = await createChat(userAId, 'Live Run');
    const held = holdNextTurn();

    const runResponse = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookieA)
      .send({
        modelId: MODEL_ID,
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Hold this turn.' }],
        },
      })
      .then((response) => response);

    await held.started;

    const response = await sendCompact(chatId);
    releaseHeldTurn?.();
    await runResponse;

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      message: expect.stringContaining('Wait for the current Run to finish.'),
    });
  });
  it('A live compact is queued for every delivery mode and retry returns the same item', async () => {
    const chatId = await createChat(userAId, 'Queued compact');
    const { user } = await seedOneTurn(chatId, userAId);
    await tenantDb.runAs(userAId, async (tx) => {
      const run = await new RunsRepository(tx).create({
        id: crypto.randomUUID(),
        chatId,
        messageId: user.id,
        userId: userAId,
        modelId: MODEL_ID,
      });

      await new RunsRepository(tx).markStarted(run.id, userAId);
    });

    for (const delivery of ['queue', 'steer', 'interrupt'] as const) {
      const id = crypto.randomUUID();
      const text = `/compact keep ${delivery}`;
      const options = { delivery, messageId: id, text };
      const first = await sendCompact(chatId, options);
      const retry = await sendCompact(chatId, options);

      expect(first.status).toBe(202);
      expect(first.body).toMatchObject({
        id,
        mode: 'queue',
        state: 'pending',
        command: 'compact',
        parts: [{ type: 'text', text }],
      });
      expect(retry.body).toEqual(first.body);
    }
  });

  it('A compact on a paused queue', async () => {
    const chatId = await createChat(userAId, 'Paused queue');
    await seedOneTurn(chatId, userAId);
    const queuedIds = [crypto.randomUUID(), crypto.randomUUID()];
    await tenantDb.runAs(userAId, async (tx) => {
      const deliveries = new ChatDeliveriesRepository(tx);

      for (const id of queuedIds) {
        await deliveries.insertPending({
          id,
          chatId,
          ownerUserId: userAId,
          mode: 'queue',
          parts: [{ type: 'text', text: `queued ${id}` }],
          settings: { modelId: MODEL_ID, permissionMode: 'default' },
        });
      }
    });
    pauseRunDispatch();

    const response = await sendCompact(chatId);

    const pending = await tenantDb.runAs(userAId, (tx) =>
      new ChatDeliveriesRepository(tx).listPending(chatId, userAId),
    );

    expect(response.status).toBe(200);
    expect(pending.map(({ id }) => id)).toEqual(queuedIds);
    expect(
      pending.every(
        ({ mode, state }) => mode === 'queue' && state === 'pending',
      ),
    ).toBe(true);
  });
});
