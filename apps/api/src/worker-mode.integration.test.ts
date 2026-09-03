/**
 * Worker execution mode e2e (#48/#50) — real HTTP + Postgres + pg-boss,
 * fake model client.
 *
 * Boots the app: POST /messages enqueues the
 * run on pg-boss, the co-located consumer executes it, and the HTTP response
 * streams from the durable run-event log via the UI-message bridge. Covers:
 *
 *   1. the bridge speaks the AI SDK UI-message protocol (existing web client
 *      works unchanged) and the turn persists end-to-end through the queue
 *   2. THE durability win: a client disconnect mid-run does not kill the run —
 *      the worker finishes, the assistant turn and terminal status persist
 *
 * Requires POSTGRES_URL (skipped otherwise), like the other e2e suites.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { CanonicalSearchCoverageService } from './search/canonical-search-activation.service';
import { configureApp } from './app.setup';
import { TenantDbService } from './db/tenant-db.service';
import { MessagesRepository } from './chats/chats-repository';
import { RunEventsRepository, RunsRepository } from './runs/runs-repository';
import {
  ModelsService,
  resolveEffortSelection,
  type ModelSelectionValidator,
} from './models/models.service';
import {
  cookieOf,
  expectRegisteredUserId,
  FakeStreamingModelClient,
  parseSseEvents,
} from './testing/support';
import { z } from 'zod';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 30_000 });

async function waitFor<T>(
  poll: () => Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `implements ModelSelectionValidator` is load-bearing: Nest overrides are not
 * structurally typechecked, so without it a method added to the narrow contract
 * surfaces as a 500 in every test here instead of a compile error.
 */
class FakeModelsService implements ModelSelectionValidator {
  readonly client = new FakeStreamingModelClient();
  readonly createClientCalls: Array<unknown> = [];

  constructor() {
    this.client.responses = ['worker answer'];
  }

  resolveModelCredential(): string {
    return 'sk-test';
  }

  validateModelSelection(modelId: string) {
    return {
      id: modelId,
      source: 'system' as const,
      contextWindowTokens: 128_000,
      provider: 'openai',
      providerModelId: 'test-provider-model',
      systemPromptTemplate: `Worker-mode prompt for ${modelId}`,
      systemPromptSource: 'project_default' as const,
    };
  }

  /** Delegates to production rather than restating the rules. */
  resolveEffortSelection(
    model: Parameters<typeof resolveEffortSelection>[0],
    requested: string | undefined,
  ): string | undefined {
    return resolveEffortSelection(model, requested);
  }

  resolveTitleModelConfig() {
    return {
      id: 'system:openai:gpt-5.4-nano',
      source: 'system',
      provider: 'openai',
      providerModelId: 'gpt-5.4-nano',
    };
  }

  createClient(modelId: string) {
    this.createClientCalls.push({ modelId });
    const client = this.client;

    return {
      get model() {
        return modelId;
      },
      provider: client.provider,
      contextWindowTokens: client.contextWindowTokens,
      streamText: (input: Parameters<typeof client.streamText>[0]) =>
        client.streamText(input),
    };
  }
}

d('queue-executed runs behind the stream bridge', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  const tag = Date.now();
  let cookie = '';
  let userId = '';

  afterEach(() => {
    // A test that throws mid-flight must not leak its slow-drip setting into
    // later tests (cubic review).
    models.client.delayMs = 0;
    models.createClientCalls.length = 0;
  });

  beforeAll(async () => {
    // Liveness (durable-run-workers D7): leave runs.timeoutSeconds /
    // runs.heartbeatSeconds at their built-in defaults (300s / 15s) — the
    // largest model delay these tests use is 2.5s, so both the in-process
    // wall-clock abort and the queue's native heartbeat window stay well out
    // of the way of the explicit-cancel/completion assertions below. (The
    // old short-tuned overrides here belonged to the deleted app-level
    // deadman/heartbeat mechanism; pg-boss's own heartbeatSeconds floor is
    // 10s, so a "make it stale fast" override is no longer viable for a
    // lightweight e2e — DB-backed liveness timing coverage is deferred to
    // tasks 7.0/7.7's composite worker harness.)

    models = new FakeModelsService();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const res = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `worker-${tag}@test.com`,
        password: 'password123',
        name: 'Worker User',
      });
    expect(res.status).toBe(201);
    cookie = cookieOf(res);
    const body: unknown = res.body;
    expectRegisteredUserId(body);
    userId = body.user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function latestRun(chatId: string) {
    const runs = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userId),
    );
    return runs.at(-1);
  }

  it('streams the turn through the queue + bridge in the UI-message protocol', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: messageId,
          parts: [{ type: 'text', text: 'Hello via the worker' }],
        },
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');

    const chunks = z
      .array(z.object({ type: z.string(), delta: z.string().optional() }))
      .parse(parseSseEvents(res.text));
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'message-metadata',
      'finish',
    ]);
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join(''),
    ).toBe('worker answer');
    expect(res.text).toContain('data: [DONE]');

    // The turn persisted end-to-end through the queue.
    const run = await latestRun(chatId);
    if (run === undefined) expect.unreachable('expected a persisted run');
    expect(run.status).toBe('completed');
    expect(run.modelId).toBe('system:openai:gpt-5.4-mini');
    expect(models.createClientCalls).toContainEqual(
      expect.objectContaining({ modelId: 'system:openai:gpt-5.4-mini' }),
    );
    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    expect(
      events.find((event) => event.eventType === 'model.requested')?.payload,
    ).toEqual({ modelId: 'system:openai:gpt-5.4-mini' });
    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    expect(messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]),
    );
  });

  it('PATCH {status: cancelled} stops an executing run mid-flight (#48)', async () => {
    models.client.delayMs = 2500;
    const chatId = crypto.randomUUID();

    // Don't await: in worker mode the response streams until the run is
    // terminal — which here happens BECAUSE of the cancel.
    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Cancel me' }],
        },
      });
    const settled = pending.then(
      (res) => res,
      () => undefined,
    );

    // Wait for the run to exist and be picked up, then cancel it.
    const run = await waitFor(
      async () => latestRun(chatId),
      10_000,
      'the run to be created',
    );
    const cancelRes = await request(http)
      .patch(`/api/v1/runs/${run.id}`)
      .set('Cookie', cookie)
      .send({ status: 'cancelled' });
    expect(cancelRes.status).toBe(200);

    const terminal = await waitFor(
      async () => {
        const current = await latestRun(chatId);
        return current?.status === 'cancelled' ? current : undefined;
      },
      15_000,
      'the run to reach cancelled',
    );
    expect(terminal.status).toBe('cancelled');

    // No completed assistant answer was produced for the cancelled turn.
    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.parts ?? []).toEqual([]);

    await settled;
  });

  it('PATCH cancel on a finished run is 409; cross-tenant is 404', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Finish first' }],
        },
      });
    expect(res.status).toBe(200);
    const run = await waitFor(
      async () => {
        const current = await latestRun(chatId);
        return current?.status === 'completed' ? current : undefined;
      },
      10_000,
      'the run to complete',
    );

    const conflict = await request(http)
      .patch(`/api/v1/runs/${run.id}`)
      .set('Cookie', cookie)
      .send({ status: 'cancelled' });
    expect(conflict.status).toBe(409);

    // Cross-tenant: another user sees 404, not 409 (no existence leak).
    const other = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `worker-b-${tag}@test.com`,
        password: 'password123',
        name: 'Worker User B',
      });
    const denied = await request(http)
      .patch(`/api/v1/runs/${run.id}`)
      .set('Cookie', cookieOf(other))
      .send({ status: 'cancelled' });
    expect(denied.status).toBe(404);
  });

  // Liveness collapse (durable-run-workers D7): the enqueue-time unwedge
  // (expire-the-blocker-and-retry) is DELETED — a crashed blocker's slot is
  // now freed by the job-queue substrate (worker-death recovery / dead-letter),
  // never by this HTTP path. A non-terminal run — "zombie" or genuinely
  // in-flight, the API can't tell the difference and no longer tries to —
  // always 409s a different message.
  it('a new message 409s while a run is in flight for the chat (no enqueue-side unwedge)', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();

    // Seed a normal completed turn so the chat + a message row exist.
    const seed = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Seed for single-flight' }],
        },
      });
    expect(seed.status).toBe(200);
    const seededRun = await waitFor(
      async () => {
        const current = await latestRun(chatId);
        return current?.status === 'completed' ? current : undefined;
      },
      10_000,
      'the seed run to complete',
    );

    // Hand-craft a non-terminal run occupying the single-flight slot.
    const {
      messageId: seededMessageId,
      modelContextSnapshotId: seededSnapshotId,
    } = seededRun;
    if (seededMessageId === null || seededSnapshotId === null) {
      throw new Error(
        'Expected the seeded run to carry a message and snapshot id',
      );
    }
    const blocker = await tenantDb.runAs(userId, async (tx) => {
      const repo = new RunsRepository(tx);
      const run = await repo.create({
        chatId,
        messageId: seededMessageId,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: seededSnapshotId,
      });
      await repo.markStarted(run.id, userId);
      return run;
    });

    // A DIFFERENT message is refused — no enqueue-side expiry attempt.
    const conflict = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Blocked by the in-flight run' }],
        },
      });
    expect(conflict.status).toBe(409);

    // The blocker is untouched — this endpoint never expires it.
    const stillBlocking = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(blocker.id, userId),
    );
    expect(stillBlocking?.status).toBe('running_model');
  });

  // DEFERRED to the later liveness test slice (tasks 7.0/7.7 — a composite
  // DB-backed worker harness is a prerequisite): a real pg-boss `runs` queue
  // with `heartbeatSeconds` set must be exercised end-to-end to cover
  // worker-death → job retried → a healthy worker re-executes to a terminal
  // result (not orphaned); retry-exhaustion → the `runs.dead` consumer writes
  // run.expired in the owner's tenant scope (no cross-tenant scan); the
  // in-process wall-clock budget (RunsWorkerService's setTimeout) firing →
  // run.expired distinct from a user run.cancelled; and a transient
  // paused-but-not-dead two-worker overlap still yielding a SINGLE terminal
  // outcome (markFinished first-writer-wins). None of this is mockable at the
  // unit level — it needs real pg-boss heartbeat/monitor timing.

  // #49 — resume: after a refresh/disconnect, GET /chats/:id/stream replays
  // the active run's UI-message stream from its persisted events and follows
  // it to completion. Nothing to resume → 204; cross-tenant/unknown → 204
  // (indistinguishable — no existence leak).
  it('GET /chats/:id/stream resumes the active run after a disconnect', async () => {
    models.client.delayMs = 2000;
    const chatId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Resume me' }],
        },
      });
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );
    await sleep(600);
    pending.abort();
    await settled;

    // Reconnect while the worker is still executing: the stream replays the
    // run from the start and closes after run completion.
    const resumed = await request(http)
      .get(`/api/v1/chats/${chatId}/stream`)
      .set('Cookie', cookie);
    expect(resumed.status).toBe(200);
    expect(resumed.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    const chunks = z
      .array(z.object({ type: z.string(), delta: z.string().optional() }))
      .parse(parseSseEvents(resumed.text));
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'message-metadata',
      'finish',
    ]);
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join(''),
    ).toBe('worker answer');

    // The run is terminal now — nothing to resume.
    const idle = await request(http)
      .get(`/api/v1/chats/${chatId}/stream`)
      .set('Cookie', cookie);
    expect(idle.status).toBe(204);

    // Cross-tenant: another user resuming this chat gets the same 204 as a
    // missing chat — no existence leak.
    const other = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `worker-resume-${tag}@test.com`,
        password: 'password123',
        name: 'Resume Other',
      });
    expect(other.status).toBe(201);
    const denied = await request(http)
      .get(`/api/v1/chats/${chatId}/stream`)
      .set('Cookie', cookieOf(other));
    expect(denied.status).toBe(204);

    models.client.delayMs = 0;
  });

  it('a client disconnect mid-run does not kill the run (durability, #48)', async () => {
    models.client.delayMs = 1500;
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: messageId,
          parts: [{ type: 'text', text: 'Refresh-proof?' }],
        },
      });
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );

    // Give the request time to persist + enqueue, then drop the connection
    // while the worker is still inside the (delayed) model call.
    await sleep(600);
    pending.abort();
    await settled;

    // The run finishes anyway: worker execution is not tied to the socket.
    const run = await waitFor(
      async () => {
        const current = await latestRun(chatId);
        return current?.status === 'completed' ? current : undefined;
      },
      15_000,
      'the run to complete after the client disconnected',
    );

    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(run.id, userId),
    );
    expect(events.map((e) => e.eventType)).toEqual([
      'run.created',
      'run.started',
      'model.requested',
      'model.delta',
      'model.completed',
      'run.completed',
    ]);

    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.parts).toEqual([{ type: 'text', text: 'worker answer' }]);
  });
});
