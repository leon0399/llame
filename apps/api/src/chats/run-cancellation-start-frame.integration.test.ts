/**
 * Acceptance-time Run identity and pre-claim cancellation over real HTTP
 * (#139, run-cancellation M1 and the settlement requirement's pre-claim half).
 *
 * This API process consumes nothing: `WorkerProfileService` reports no `runs`
 * concurrency, so an accepted Run stays `queued` and every assertion below is
 * about what the owner's client learns — and can act on — before any worker
 * claims the Run. Reading the response incrementally is the point: supertest
 * resolves on a complete body, which a stream whose Run never runs never has.
 * A second `WorkerModule` graph (same pg-boss schema, its own model double) is
 * booted only in the one test where a pickup is what is under test.
 *
 * Requires POSTGRES_URL to point at a migrated database, like every other
 * *.integration.test.ts here; the test:integration globalSetup provides it.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { ModelsService } from '../models/models.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  cookieOf,
  expectRegisteredUserId,
  FakeModelsService,
  openSseStream,
  waitFor,
  type IncrementalSseResponse,
} from '../testing/support';
import { WorkerModule } from '../worker.module';
import { MessagesRepository } from './chats-repository';

const MODEL_ID = 'system:openai:gpt-5.4-mini';
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'];

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

type DrizzleWithClient = PostgresJsDatabase & { $client: Sql };

/**
 * A `runs`-consuming WorkerModule graph in this same process and pg-boss
 * schema, so a Run the API enqueued is picked up by a real worker loop.
 *
 * @param models - The model double this worker would use, had it made a request
 * @returns A close handle that drains the worker and its own DB connection
 */
async function bootRunsWorker(
  models: FakeModelsService,
): Promise<{ close(): Promise<void> }> {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ModelsService)
    .useValue(models)
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(WorkerProfileService)
    .useValue({
      concurrencyFor: (group: string) => (group === 'runs' ? 1 : null),
    })
    .compile();
  await moduleRef.init();
  const db = moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });
  return {
    async close() {
      await moduleRef.close();
      await db.$client.end();
    },
  };
}

d('an accepted Run no worker consumes', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  const tag = Date.now();
  let cookieA = '';
  let userAId = '';
  let cookieB = '';

  const chatIds: Array<string> = [];
  const openStreams: Array<IncrementalSseResponse> = [];

  /**
   * Registers a user and returns its session cookie and id.
   *
   * @param email - The email address to register
   * @param name - The display name to register
   * @returns The session cookie and created user id
   */
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
      // No `runs` group in this process's profile: nothing here claims a Run,
      // which is the whole premise of this suite.
      .overrideProvider(WorkerProfileService)
      .useValue({ concurrencyFor: () => null })
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    // A real listening port, not supertest's per-request one: the incremental
    // reader outlives any single request.
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const userA = await register(`start-frame-a-${tag}@test.com`, 'Owner A');
    cookieA = userA.cookie;
    userAId = userA.userId;
    const userB = await register(`start-frame-b-${tag}@test.com`, 'Owner B');
    cookieB = userB.cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    for (const stream of openStreams.splice(0)) {
      stream.close();
    }
    // Every Run here is deliberately left unclaimed, and its job stays on the
    // queue: terminalize the leftovers so the one worker boot in this file
    // only ever attempts the Run its own test cancelled.
    for (const chatId of chatIds.splice(0)) {
      await tenantDb.runAs(userAId, async (tx) => {
        const repo = new RunsRepository(tx);
        for (const run of await repo.findByChatId(chatId, userAId)) {
          if (!TERMINAL_STATUSES.includes(run.status)) {
            await repo.markFinished(run.id, userAId, 'cancelled', {
              error: { message: 'test cleanup' },
            });
          }
        }
      });
    }
  });

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userAId),
    );

  const runById = (runId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new RunsRepository(tx).findById(runId, userAId),
    );

  const eventTypesOf = async (runId: string) => {
    const events = await tenantDb.runAs(userAId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userAId),
    );
    return events.map((event) => event.eventType);
  };

  const messagesOf = (chatId: string) =>
    tenantDb.runAs(userAId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userAId),
    );

  /** Accept a turn for a fresh chat and keep its stream open for reading. */
  async function acceptTurn(
    chatId: string,
    text: string,
  ): Promise<IncrementalSseResponse> {
    chatIds.push(chatId);
    const stream = await openSseStream({
      server: http,
      method: 'POST',
      path: `/api/v1/chats/${chatId}/messages`,
      cookie: cookieA,
      body: {
        modelId: MODEL_ID,
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text }],
        },
      },
    });
    openStreams.push(stream);
    return stream;
  }

  it("the message stream's first frame names the Run while it is still queued", async () => {
    const chatId = crypto.randomUUID();
    const stream = await acceptTurn(chatId, 'Name the Run at acceptance');

    expect(stream.status).toBe(200);
    const first = await stream.nextFrame('the first frame');
    expect(first.type).toBe('start');

    const runs = await runsOf(chatId);
    expect(runs).toHaveLength(1);
    expect(first.messageId).toBe(runs[0].id);
    expect(runs[0].status).toBe('queued');
    // The frame arrived on the strength of acceptance alone: the event log
    // holds only the Run's creation and no model request was ever made.
    expect(await eventTypesOf(runs[0].id)).toEqual(['run.created']);
    expect(models.client.turns).toHaveLength(0);
  });

  it('cancelling the named Run settles it cancelled at pickup, with no model request and no assistant message', async () => {
    const chatId = crypto.randomUUID();
    const stream = await acceptTurn(chatId, 'Stop me before a worker claims');
    const first = await stream.nextFrame('the start frame');
    const runId = z.string().parse(first.messageId);

    const cancelled = await request(http)
      .patch(`/api/v1/runs/${runId}`)
      .set('Cookie', cookieA)
      .send({ status: 'cancelled' });
    expect(cancelled.status).toBe(200);

    // Recorded, not yet settled: no worker has seen this Run at all.
    const stamped = await runById(runId);
    expect(stamped?.status).toBe('queued');
    expect(stamped?.cancelRequestedAt).not.toBeNull();

    const workerModels = new FakeModelsService();
    const worker = await bootRunsWorker(workerModels);
    try {
      const settled = await waitFor(
        async () => {
          const run = await runById(runId);
          return run?.status === 'cancelled' ? run : undefined;
        },
        20_000,
        'the queued Run to settle cancelled at pickup',
      );
      expect(settled.finishedAt).not.toBeNull();

      // Settled without ever asking for a model client, let alone a turn.
      expect(workerModels.createClientCalls).toEqual([]);
      expect(workerModels.client.turns).toHaveLength(0);
      expect(await eventTypesOf(runId)).toEqual([
        'run.created',
        'run.cancelled',
      ]);
      const messages = await messagesOf(chatId);
      expect(
        messages.filter((message) => message.role === 'assistant'),
      ).toEqual([]);

      // The stream the client still holds ends on the terminal event.
      const last = await stream.nextFrame('the finish frame');
      expect(last.type).toBe('finish');
    } finally {
      await worker.close();
    }
  });

  it('the resume stream of an active Run starts with the same frame', async () => {
    const chatId = crypto.randomUUID();
    const accepted = await acceptTurn(chatId, 'Resume before any output');
    const first = await accepted.nextFrame('the start frame');
    // The client is gone; the Run is still queued, so it is still resumable.
    accepted.close();

    const resumed = await openSseStream({
      server: http,
      method: 'GET',
      path: `/api/v1/chats/${chatId}/stream`,
      cookie: cookieA,
    });
    openStreams.push(resumed);

    expect(resumed.status).toBe(200);
    const resumedFirst = await resumed.nextFrame(
      'the resumed stream start frame',
    );
    expect(resumedFirst).toEqual(first);
  });

  it('another owner neither resumes the chat nor records a cancellation', async () => {
    const chatId = crypto.randomUUID();
    const accepted = await acceptTurn(chatId, 'Only my owner may stop this');
    const first = await accepted.nextFrame('the start frame');
    const runId = z.string().parse(first.messageId);

    const resumed = await request(http)
      .get(`/api/v1/chats/${chatId}/stream`)
      .set('Cookie', cookieB);
    expect(resumed.status).toBe(204);
    expect(resumed.text).toBe('');

    const denied = await request(http)
      .patch(`/api/v1/runs/${runId}`)
      .set('Cookie', cookieB)
      .send({ status: 'cancelled' });
    expect(denied.status).toBe(404);

    const untouched = await runById(runId);
    expect(untouched?.status).toBe('queued');
    expect(untouched?.cancelRequestedAt).toBeNull();
  });
});
