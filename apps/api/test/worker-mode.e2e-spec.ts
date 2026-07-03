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
import { eq } from 'drizzle-orm';
import { type ModelMessage, type streamText } from 'ai';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { runs } from './../src/db/schema';
import { TenantDbService } from './../src/db/tenant-db.service';
import { MessagesRepository } from './../src/chats/chats-repository';
import {
  RunEventsRepository,
  RunsRepository,
} from './../src/runs/runs-repository';
import { RUN_TIMEOUTS_QUEUE } from './../src/runs/run-queues';
import { ModelsService } from './../src/models/models.service';
import { QUEUE, type Queue } from './../src/queue/queue';
import { TITLE_SYSTEM_PROMPT } from './../src/titles/title';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

jest.setTimeout(30_000);

const cookieOf = (res: request.Response): string => {
  const set = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  for (const c of set) {
    const m = /llame_session=([^;]+)/.exec(c);
    if (m) return `llame_session=${m[1]}`;
  }
  return '';
};

function sseData(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((block) =>
      block
        .trim()
        .split('\n')
        .find((line) => line.startsWith('data: ')),
    )
    .filter((line): line is string => line !== undefined)
    .map((line) => line.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data): unknown => JSON.parse(data) as unknown);
}

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

/** Resolves true when aborted before the delay elapses, false otherwise. */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class FakeWorkerModelClient {
  readonly model = 'gpt-4o-mini';
  readonly provider = 'openai';
  response = 'worker answer';
  delayMs = 0;

  streamText(input: {
    system?: string;
    messages: ModelMessage[];
    abortSignal?: AbortSignal;
    onTextDelta?: (text: string) => void;
    onError?: (event: { error: unknown }) => void | Promise<void>;
    onFinish?: (event: {
      text: string;
      usage: Record<string, number>;
      finishReason: string;
    }) => void | Promise<void>;
  }): ReturnType<typeof streamText> {
    if (input.system === TITLE_SYSTEM_PROMPT) {
      return {
        text: Promise.resolve('Generated Title'),
      } as unknown as ReturnType<typeof streamText>;
    }

    const text = this.response;
    const done = (async () => {
      if (this.delayMs > 0) {
        const aborted = await sleepOrAbort(this.delayMs, input.abortSignal);
        if (aborted) {
          // Mirror the real client: an aborted call errors instead of finishing.
          await input.onError?.({ error: new Error('aborted') });
          return;
        }
      }
      input.onTextDelta?.(text);
      await input.onFinish?.({
        text,
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        finishReason: 'stop',
      });
    })();

    return {
      text: done.then(() => text),
      consumeStream: () => done,
    } as unknown as ReturnType<typeof streamText>;
  }
}

class FakeModelsService {
  readonly client = new FakeWorkerModelClient();
  resolveModelCredential(): string {
    return 'sk-test';
  }
  resolveForModel(): string {
    return 'sk-test';
  }
  listAvailableModels(): { id: string }[] {
    return [{ id: 'fake-model' }];
  }
  createOpenAIClient() {
    return this.client;
  }
  createModelClient() {
    return this.client;
  }
}

d('queue-executed runs behind the stream bridge', () => {
  let app: INestApplication;
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
  });

  beforeAll(async () => {
    // Liveness tuned for tests (#48): deadman after 2s, stale after 2s,
    // heartbeat every 1s — live runs stay fresh, hand-staled zombies expire.
    process.env.RUN_TIMEOUT_SECONDS = '2';
    process.env.RUN_HEARTBEAT_STALE_SECONDS = '2';
    process.env.RUN_HEARTBEAT_SECONDS = '1';

    models = new FakeModelsService();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer() as import('http').Server;
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
    userId = (res.body as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    delete process.env.RUN_TIMEOUT_SECONDS;
    delete process.env.RUN_HEARTBEAT_STALE_SECONDS;
    delete process.env.RUN_HEARTBEAT_SECONDS;
    await app?.close();
  });

  async function latestRun(chatId: string) {
    const runs = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userId),
    );
    return runs[runs.length - 1];
  }

  it('streams the turn through the queue + bridge in the UI-message protocol', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        message: {
          id: messageId,
          parts: [{ type: 'text', text: 'Hello via the worker' }],
        },
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');

    const chunks = sseData(res.text) as Array<{
      type: string;
      delta?: string;
    }>;
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
    expect(run.status).toBe('completed');
    const messages = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    expect(messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]),
    );
  });

  it('PATCH {status: cancelled} stops an executing run mid-flight (#48)', async () => {
    models.client.delayMs = 2_500;
    const chatId = crypto.randomUUID();

    // Don't await: in worker mode the response streams until the run is
    // terminal — which here happens BECAUSE of the cancel.
    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
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

  // Review hardening: a zombie non-terminal run (crashed executor, stale
  // heartbeat) blocking a chat's single-flight slot is expired and replaced
  // when the user sends a NEW message — the chat can never be wedged.
  it('a new message supersedes a stale zombie run instead of 409ing', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();

    // Seed a normal completed turn so the chat + a message row exist.
    const seed = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Seed for unwedge' }],
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

    // Hand-craft the zombie occupying the single-flight slot.
    const zombie = await tenantDb.runAs(userId, async (tx) => {
      const repo = new RunsRepository(tx);
      const run = await repo.create({
        chatId,
        messageId: seededRun.messageId as string,
        userId,
      });
      await repo.markStarted(run.id, userId);
      await tx
        .update(runs)
        .set({ heartbeatAt: new Date(Date.now() - 60_000) })
        .where(eq(runs.id, run.id));
      return run;
    });

    // A DIFFERENT message unwedges: the zombie is expired, the new turn runs.
    const unwedge = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Unwedge me' }],
        },
      });
    expect(unwedge.status).toBe(200);

    const expired = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(zombie.id, userId),
    );
    expect(expired?.status).toBe('expired');

    await waitFor(
      async () => {
        const current = await latestRun(chatId);
        return current?.id !== zombie.id && current?.status === 'completed'
          ? current
          : undefined;
      },
      10_000,
      'the unwedging turn to complete',
    );
  });

  it('the deadman expires a zombie run whose heartbeat went stale (#48)', async () => {
    models.client.delayMs = 0;
    const chatId = crypto.randomUUID();

    // A normal completed turn provides the chat + a real user message row.
    const seed = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text: 'Seed turn' }],
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

    // Hand-craft the zombie: a run that "started" but whose worker died —
    // running_model with a heartbeat a minute in the past.
    const zombie = await tenantDb.runAs(userId, async (tx) => {
      const repo = new RunsRepository(tx);
      const run = await repo.create({
        chatId,
        messageId: seededRun.messageId as string,
        userId,
      });
      await repo.markStarted(run.id, userId);
      await tx
        .update(runs)
        .set({ heartbeatAt: new Date(Date.now() - 60_000) })
        .where(eq(runs.id, run.id));
      return run;
    });

    // Fire its deadman immediately (no startAfter wait).
    const queue = app.get<Queue>(QUEUE);
    await queue.enqueue(RUN_TIMEOUTS_QUEUE, {
      runId: zombie.id,
      userId,
    });

    const expired = await waitFor(
      async () => {
        const current = await tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(zombie.id, userId),
        );
        return current?.status === 'expired' ? current : undefined;
      },
      15_000,
      'the zombie run to expire',
    );
    expect(expired.finishedAt).not.toBeNull();

    const events = await tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(zombie.id, userId),
    );
    expect(events.map((e) => e.eventType)).toContain('run.expired');

    // The seeded run's own deadman must have left it untouched.
    const seededAfter = await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(seededRun.id, userId),
    );
    expect(seededAfter?.status).toBe('completed');
  });

  // #49 — resume: after a refresh/disconnect, GET /chats/:id/stream replays
  // the active run's UI-message stream from its persisted events and follows
  // it to completion. Nothing to resume → 204; cross-tenant/unknown → 204
  // (indistinguishable — no existence leak).
  it('GET /chats/:id/stream resumes the active run after a disconnect', async () => {
    models.client.delayMs = 2_000;
    const chatId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
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
    const chunks = sseData(resumed.text) as Array<{
      type: string;
      delta?: string;
    }>;
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
    models.client.delayMs = 1_500;
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const pending = request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
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
