/**
 * The follow-up route over real HTTP (turn-actions D1): `POST
 * /api/v1/chats/:chatId/messages/:userMessageId/runs` admits a Continue Run and
 * answers the same UI-message stream a chat send does, so the client learns the
 * new Run from the first frame. This API process consumes nothing — the worker
 * profile reports no `runs` concurrency — so every assertion below is about what
 * the owner learns at acceptance, before any model request.
 *
 * Requires POSTGRES_URL to point at a migrated database, like every other
 * `.integration.test.ts` here; the test:integration globalSetup provides it.
 */

import { type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { ModelsService } from '../models/models.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  cookieOf,
  expectRegisteredUserId,
  FakeModelsService,
  openSseStream,
  type IncrementalSseResponse,
} from '../testing/support';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

const MODEL_ID = 'system:openai:gpt-5.4-mini';
const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

/** A turn that can be continued: a user message, a failed Run, and its reply. */
type FailedTurn = {
  chatId: string;
  messageId: string;
  runId: string;
};

/** A settled tool pair a Continue Run can resume from. */
const KEPT_PARTS: Array<unknown> = [
  { type: 'text', text: 'reading the file' },
  {
    type: 'tool-read',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { path: '/tmp/file.txt' },
    output: { status: 'success', text: 'file body' },
    outcome: 'success',
  },
];

d('the follow-up route', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  const tag = Date.now();
  let cookieA = '';
  let userAId = '';
  let cookieB = '';
  const chatIds: Array<string> = [];
  const openStreams: Array<IncrementalSseResponse> = [];

  async function register(
    email: string,
    name: string,
  ): Promise<{ cookie: string; userId: string }> {
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
      .overrideProvider(WorkerProfileService)
      .useValue({ concurrencyFor: () => null })
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const userA = await register(`continue-route-a-${tag}@test.com`, 'Owner A');
    cookieA = userA.cookie;
    userAId = userA.userId;
    cookieB = (await register(`continue-route-b-${tag}@test.com`, 'Owner B'))
      .cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    for (const stream of openStreams.splice(0)) {
      stream.close();
    }
    // Every Run here stays queued on purpose; terminalize the leftovers so the
    // next test's single-flight admission is not blocked by one.
    for (const chatId of chatIds.splice(0)) {
      await tenantDb.runAs(userAId, async (tx) => {
        const repo = new RunsRepository(tx);
        for (const run of await repo.findByChatId(chatId, userAId)) {
          if (
            !['completed', 'failed', 'cancelled', 'expired'].includes(
              run.status,
            )
          ) {
            await repo.markFinished(run.id, userAId, 'cancelled', {
              error: { message: 'test cleanup' },
            });
          }
        }
      });
    }
  });

  /**
   * A Chat whose latest turn is a failed Run with a reply the Continue check
   * accepts. Seeded directly: the point is the route, not how the turn failed.
   */
  async function seedFailedTurn(
    options: {
      laterUserMessage?: boolean;
      status?: 'failed' | 'completed';
    } = {},
  ): Promise<FailedTurn> {
    const chatId = crypto.randomUUID();
    chatIds.push(chatId);
    return tenantDb.runAs(userAId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userAId,
        title: 'Continue route',
      });
      const messagesRepo = new MessagesRepository(tx);
      const userMessage = await messagesRepo.create({
        chatId,
        role: 'user',
        senderUserId: userAId,
        parts: [{ type: 'text', text: 'Do the work' }],
      });
      if (options.laterUserMessage === true) {
        await messagesRepo.create({
          chatId,
          role: 'user',
          senderUserId: userAId,
          parts: [{ type: 'text', text: 'A later question' }],
        });
      }
      const runsRepo = new RunsRepository(tx);
      const run = await runsRepo.create({
        chatId,
        messageId: userMessage.id,
        userId: userAId,
        modelId: MODEL_ID,
      });
      const status = options.status ?? 'failed';
      await runsRepo.markFinished(run.id, userAId, status, {
        error: { message: 'the model dropped the stream' },
      });
      await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: userMessage.id,
        parts: KEPT_PARTS,
        usage: {
          status: status === 'completed' ? 'completed' : 'error',
          complete: false,
          runId: run.id,
          modelId: MODEL_ID,
        },
      });
      return { chatId, messageId: userMessage.id, runId: run.id };
    });
  }

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userAId),
    );

  const eventsOf = (runId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userAId),
    );

  /** Post a follow-up request for `turn` and keep its stream open. */
  async function followUp(
    turn: FailedTurn,
    // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the JSON body this test sends to its own route, written as the documented fields.
    body: Record<string, unknown>,
    cookie = cookieA,
  ): Promise<IncrementalSseResponse> {
    const stream = await openSseStream({
      server: http,
      method: 'POST',
      path: `/api/v1/chats/${turn.chatId}/messages/${turn.messageId}/runs`,
      cookie,
      body,
    });
    openStreams.push(stream);
    return stream;
  }

  it('starts a Continue Run whose id is the stream start frame', async () => {
    const turn = await seedFailedTurn();

    const stream = await followUp(turn, { action: 'continue' });

    expect(stream.status).toBe(200);
    const first = await stream.nextFrame('the first frame');
    expect(first.type).toBe('start');

    const runs = await runsOf(turn.chatId);
    expect(runs).toHaveLength(2);
    const continued = runs.find((run) => run.id !== turn.runId);
    expect(continued).toMatchObject({
      messageId: turn.messageId,
      followUpAction: 'continue',
      sourceRunId: turn.runId,
      modelId: MODEL_ID,
      permissionMode: 'default',
      status: 'queued',
    });
    expect(first.messageId).toBe(continued?.id);

    // The Run's log starts with its identity and the kept parts.
    const events = await eventsOf(continued!.id);
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'run.created',
      'run.continued',
    ]);
    expect(events[1]?.payload).toMatchObject({
      sourceRunId: turn.runId,
      parts: KEPT_PARTS,
    });
    // Nothing reached a model: this process consumes no Run.
    expect(models.client.turns).toHaveLength(0);
  });

  it('refuses a body the continue variant does not describe', async () => {
    const turn = await seedFailedTurn();

    // The schema has no model or effort on `continue`, so the request is not
    // that variant at all: validation answers 400 before admission runs.
    const named = await followUp(turn, {
      action: 'continue',
      modelId: MODEL_ID,
      effort: '0',
    });
    expect(named.status).toBe(400);

    // `regenerate` is a variant a later action adds; until then it is not one
    // this route describes either.
    const regenerate = await followUp(turn, { action: 'regenerate' });
    expect(regenerate.status).toBe(400);

    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it('refuses a request with no body at all', async () => {
    const turn = await seedFailedTurn();

    // No content-type and no body: the route answers the empty request it got,
    // rather than failing to read a field off nothing.
    const refused = await request(http)
      .post(`/api/v1/chats/${turn.chatId}/messages/${turn.messageId}/runs`)
      .set('Cookie', cookieA);

    expect(refused.status).toBe(400);
    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it('refuses a follow-up on an older turn', async () => {
    const turn = await seedFailedTurn({ laterUserMessage: true });

    const stream = await followUp(turn, { action: 'continue' });

    expect(stream.status).toBe(409);
    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it('refuses to continue a completed turn', async () => {
    const turn = await seedFailedTurn({ status: 'completed' });

    const stream = await followUp(turn, { action: 'continue' });

    expect(stream.status).toBe(409);
    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it("answers 404 for another owner's chat and creates nothing", async () => {
    const turn = await seedFailedTurn();
    const before = await runsOf(turn.chatId);

    const stream = await followUp(turn, { action: 'continue' }, cookieB);

    expect(stream.status).toBe(404);
    expect(await runsOf(turn.chatId)).toEqual(before);
  });

  it('accepts the new Run id as the message a client would send next', async () => {
    const turn = await seedFailedTurn();
    const stream = await followUp(turn, { action: 'continue' });
    const first = await stream.nextFrame('the start frame');

    const runId = z.string().parse(first.messageId);
    const run = await tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findById(runId, userAId),
    );
    expect(run?.messageId).toBe(turn.messageId);
  });
});
