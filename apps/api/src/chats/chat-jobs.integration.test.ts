/**
 * The owner's jobs API (background-jobs, job-store layer) — real HTTP and
 * Postgres with RLS active: the list, the stop request, the 404, 409, and
 * repeated-stop answers, and `runningJobs` on the chat list and the live record.
 *
 * Requires TEST_DATABASE_URL (throws without it); run by `test:integration`.
 */

import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  ChatJobsRepository,
  type NewChatJob,
} from '../jobs/chat-jobs.repository';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import { WorkerHeartbeatService } from '../jobs/worker-heartbeat.service';
import {
  LIVE_RECORD_LOADER,
  type LiveRecordLoader,
} from '../live/live-record-loader';
import { ModelsService } from '../models/models.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { newChatJob } from '../testing/chat-job-rows';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';
import { ChatsRepository } from './chats-repository';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'chat-jobs.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 60_000 });

const jobBody = z.object({
  id: z.string(),
  locator: z.string(),
  state: z.string(),
  stoppedBy: z.string().nullable(),
  stopRequestedBy: z.string().nullable(),
  outcomeUnknown: z.boolean(),
  truncated: z.array(z.string()),
});

const listBody = z.object({ items: z.array(jobBody) });

describe('chat jobs API', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  let db: PostgresJsDatabase<typeof schema>;
  let liveWorker: string;
  let deadWorker: string;

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
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(new FakeModelsService())
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
    db = app.get<PostgresJsDatabase<typeof schema>>('DB_DEV', {
      strict: false,
    });
    liveWorker = app.get(WorkerHeartbeatService, { strict: false }).instanceId;
    deadWorker = crypto.randomUUID();

    await db.execute(sql`INSERT INTO worker_instances (id, last_seen_at)
      VALUES (${deadWorker}, now() - make_interval(secs => ${workerDeadAfterSeconds(BUILT_IN_DEFAULTS) + 5}))`);

    const userA = await register(`jobs-a-${tag}@example.com`, 'A');

    cookieA = userA.cookie;
    userAId = userA.userId;
    const userB = await register(`jobs-b-${tag}@example.com`, 'B');

    cookieB = userB.cookie;
    userBId = userB.userId;
  });

  afterAll(async () => {
    await db?.execute(
      sql`DELETE FROM worker_instances WHERE id = ${deadWorker}`,
    );
    await app?.close();
  });

  async function createChat(userId = userAId): Promise<string> {
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userId, title: 'Jobs' }),
    );

    return chat.id;
  }

  async function startJob(
    chatId: string,
    seq: number,
    overrides: Partial<NewChatJob> = {},
  ) {
    return tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).insert(
        newChatJob({
          chatId,
          ownerUserId: userAId,
          seq,
          workerInstanceId: liveWorker,
          ...overrides,
        }),
      ),
    );
  }

  const list = (chatId: string, cookie = cookieA) =>
    request(http).get(`/api/v1/chats/${chatId}/jobs`).set('Cookie', cookie);

  const stop = (chatId: string, jobId: string, cookie = cookieA) =>
    request(http)
      .patch(`/api/v1/chats/${chatId}/jobs/${jobId}`)
      .set('Cookie', cookie)
      .send({ state: 'cancelled' });

  const stateOf = async (chatId: string, jobId: string) => {
    const rows = await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).findById(chatId, userAId, jobId),
    );

    return rows;
  };

  it('lists the jobs of the Chat with the live jobs first', async () => {
    const chatId = await createChat();
    const done = await startJob(chatId, 2);

    await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).settle(chatId, userAId, done.id, {
        state: 'succeeded',
        result: { truncated: { stdout: true, stderr: false } },
      }),
    );
    await startJob(chatId, 4);

    const res = await list(chatId);

    expect(res.status).toBe(200);
    const body = listBody.parse(res.body);

    expect(body.items.map((item) => [item.locator, item.state])).toEqual([
      ['job://bash-4', 'running'],
      ['job://bash-2', 'succeeded'],
    ]);
    expect(body.items.map((item) => item.truncated)).toEqual([[], ['stdout']]);
  });

  it('settles the job of a dead worker as lost when it lists', async () => {
    const chatId = await createChat();

    await startJob(chatId, 1, { workerInstanceId: deadWorker });

    const body = listBody.parse((await list(chatId)).body);

    expect(body.items).toMatchObject([{ state: 'lost', outcomeUnknown: true }]);
  });

  // Scenario: Another owner reads a job
  it('answers 404 to another owner who lists the jobs of a Chat', async () => {
    const chatId = await createChat();

    await startJob(chatId, 1);

    expect((await list(chatId, cookieB)).status).toBe(404);
    expect((await list(crypto.randomUUID())).status).toBe(404);
    expect((await list('not-a-uuid')).status).toBe(400);
  });

  it('records an owner stop request on a running job and repeats it', async () => {
    const chatId = await createChat();
    const first = await startJob(chatId, 1);
    const second = await startJob(chatId, 2);

    const res = await stop(chatId, first.id);

    expect(res.status).toBe(200);
    expect(jobBody.parse(res.body)).toMatchObject({
      state: 'running',
      stopRequestedBy: 'owner',
    });

    // The request is recorded on the first job only.
    expect((await stateOf(chatId, second.id))?.stopRequestedAt).toBeNull();
    expect((await stateOf(chatId, first.id))?.stopRequestedAt).not.toBeNull();

    expect((await stop(chatId, first.id)).status).toBe(200);
  });

  // Scenario: A stop of a settled job
  it('answers 409 to a stop of a job that already succeeded', async () => {
    const chatId = await createChat();
    const job = await startJob(chatId, 1);

    await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).settle(chatId, userAId, job.id, {
        state: 'succeeded',
        result: { exitCode: 0 },
      }),
    );

    expect((await stop(chatId, job.id)).status).toBe(409);
    expect(await stateOf(chatId, job.id)).toMatchObject({ state: 'succeeded' });
  });

  // Scenario: A repeated stop of a stopped job
  it('answers 200 to a repeated stop of a job that the owner stopped', async () => {
    const chatId = await createChat();
    const job = await startJob(chatId, 1);

    await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).settle(chatId, userAId, job.id, {
        state: 'cancelled',
        stoppedBy: 'owner',
        result: { truncated: { stdout: true, stderr: false } },
      }),
    );

    const res = await stop(chatId, job.id);

    expect(res.status).toBe(200);
    expect(jobBody.parse(res.body)).toMatchObject({
      state: 'cancelled',
      stoppedBy: 'owner',
      truncated: ['stdout'],
    });
    expect(await stateOf(chatId, job.id)).toMatchObject({ state: 'cancelled' });
  });

  it('answers 409 to a stop of a job that another stopper cancelled', async () => {
    const chatId = await createChat();
    const job = await startJob(chatId, 1);

    await tenantDb.runAs(userAId, (tx) =>
      new ChatJobsRepository(tx).settle(chatId, userAId, job.id, {
        state: 'cancelled',
        stoppedBy: 'assistant',
      }),
    );

    expect((await stop(chatId, job.id)).status).toBe(409);
  });

  it('answers 409 and settles lost when the job sits on a dead worker', async () => {
    const chatId = await createChat();
    const job = await startJob(chatId, 1, { workerInstanceId: deadWorker });

    expect((await stop(chatId, job.id)).status).toBe(409);
    expect(await stateOf(chatId, job.id)).toMatchObject({ state: 'lost' });
  });

  describe('404 answers', () => {
    it('answers 404 to an unknown job, a job of another Chat, and an unknown Chat', async () => {
      const chatId = await createChat();
      const otherChat = await createChat();
      const job = await startJob(otherChat, 1);

      expect((await stop(chatId, crypto.randomUUID())).status).toBe(404);
      expect((await stop(chatId, job.id)).status).toBe(404);
      expect((await stop(crypto.randomUUID(), job.id)).status).toBe(404);
      expect(await stateOf(otherChat, job.id)).toMatchObject({
        state: 'running',
      });
    });

    // Scenario: Another owner cannot stop a job
    it('answers 404 to another owner and leaves the job running', async () => {
      const chatId = await createChat();
      const job = await startJob(chatId, 1);

      expect((await stop(chatId, job.id, cookieB)).status).toBe(404);

      expect(await stateOf(chatId, job.id)).toMatchObject({
        state: 'running',
        stopRequestedAt: null,
        stopRequestedBy: null,
      });
      expect(userBId).not.toBe(userAId);
    });

    it('answers 400 to a malformed id or a state that a request cannot set', async () => {
      const chatId = await createChat();
      const job = await startJob(chatId, 1);

      const bad = await request(http)
        .patch(`/api/v1/chats/${chatId}/jobs/${job.id}`)
        .set('Cookie', cookieA)
        .send({ state: 'succeeded' });

      expect(bad.status).toBe(400);
      expect((await stop(chatId, 'nope')).status).toBe(400);
      expect(await stateOf(chatId, job.id)).toMatchObject({ state: 'running' });
    });
  });

  describe('runningJobs', () => {
    const itemOf = async (chatId: string) => {
      const res = await request(http)
        .get('/api/v1/chats')
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);

      return z
        .array(z.object({ id: z.string(), runningJobs: z.number() }))
        .parse(res.body)
        .find((item) => item.id === chatId);
    };

    it('counts the running jobs on a live worker in the list and the live record', async () => {
      const chatId = await createChat();

      await startJob(chatId, 1);
      await startJob(chatId, 2);

      const done = await startJob(chatId, 3);

      await tenantDb.runAs(userAId, (tx) =>
        new ChatJobsRepository(tx).settle(chatId, userAId, done.id, {
          state: 'failed',
        }),
      );

      expect(await itemOf(chatId)).toMatchObject({ runningJobs: 2 });

      const loader = app.get<LiveRecordLoader>(LIVE_RECORD_LOADER, {
        strict: false,
      });

      expect(await loader.chat(userAId, chatId)).toMatchObject({
        runningJobs: 2,
      });
    });

    it('counts a Chat with no job as zero', async () => {
      const chatId = await createChat();

      expect(await itemOf(chatId)).toMatchObject({ runningJobs: 0 });
    });

    // Scenario: A job on a dead worker is not counted
    it('does not count a job on a dead worker, and settles nothing', async () => {
      const chatId = await createChat();
      const job = await startJob(chatId, 1, { workerInstanceId: deadWorker });

      expect(await itemOf(chatId)).toMatchObject({ runningJobs: 0 });

      const loader = app.get<LiveRecordLoader>(LIVE_RECORD_LOADER, {
        strict: false,
      });

      expect(await loader.chat(userAId, chatId)).toMatchObject({
        runningJobs: 0,
      });
      expect(await stateOf(chatId, job.id)).toMatchObject({ state: 'running' });
    });
  });
});
