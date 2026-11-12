import type { RunWaitService } from '../runs/run-wait.service';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq, sql as query } from 'drizzle-orm';
import { BashProcessLimiter } from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunsRepository, RunEventsRepository } from '../runs/runs-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { WorkerHeartbeatService } from '../jobs/worker-heartbeat.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatJobsService } from '../chats/chat-jobs.service';
import { RunControlListenerService } from '../runs/run-control-listener.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { PostgresChangeListener } from '../live/change-listener';
import { RUN_CONTROL_CHANNEL, notifyRunControl } from '../runs/run-control';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ChatsService } from '../chats/chats.service';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { bashTool } from './bash';
import { runTool } from './runner';
import { stopTool } from './stop';
import { type ToolContext } from './types';
import { FakeModelsService } from '../testing/fake-streaming-model-client';
import { JobNoticeRunService } from '../runs/job-notice-run.service';

const config = { config: BUILT_IN_DEFAULTS };

const noticeRuns = new JobNoticeRunService(
  new FakeModelsService(),
  config,
  {
    enqueueInTransaction: async () => {},
  },
  { wakeForChatInTransaction: () => Promise.resolve(false) } satisfies Pick<
    RunWaitService,
    'wakeForChatInTransaction'
  >,
);

describe('real host async jobs', () => {
  let sql: Sql;
  let tenant: TenantDbService;
  let owner: string;
  let registry: BashJobRegistry;
  let heartbeat: WorkerHeartbeatService;
  let context: ToolContext;
  let listener: RunControlListenerService | undefined;
  let runAborts: RunAbortRegistry;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;

    if (!url) throw new Error('Integration database was not provisioned.');
    sql = postgres(url, { max: 6 });
    tenant = new TenantDbService(drizzle(sql, { schema }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users(id,name,email) VALUES (${owner}, 'Async', ${`${owner}@test.com`})`;
  });
  beforeEach(async () => {
    runAborts = new RunAbortRegistry();
    heartbeat = new WorkerHeartbeatService(drizzle(sql, { schema }), config, {
      concurrencyFor: () => 1,
    });
    registry = new BashJobRegistry(tenant, heartbeat, config, noticeRuns);
    registry.onModuleInit();
    await heartbeat.beat();

    const seeded = await tenant.runAs(owner, async (db) => {
      const chat = await new ChatsRepository(db).create({
        ownerUserId: owner,
        title: 'Async bash',
      });

      const message = await new MessagesRepository(db).create({
        chatId: chat.id,
        senderUserId: owner,
        role: 'user',
        parts: [{ type: 'text', text: 'Build' }],
      });

      const runs = new RunsRepository(db);

      const run = await runs.create({
        chatId: chat.id,
        userId: owner,
        messageId: message.id,
        modelId: 'test-model',
      });

      const startedRun = await runs.markStarted(run.id, owner);

      if (startedRun === undefined) throw new Error('Could not start the Run.');

      const started = await new RunEventsRepository(db).append(
        run.id,
        'run.started',
      );

      return { chat, run: startedRun, sequence: started.sequence };
    });

    context = {
      configuredCredentials: [],
      userId: owner,
      chatId: seeded.chat.id,
      tenantDb: tenant,
      runId: seeded.run.id,
      nativeExecutorId: 'async-host',
      attemptId: seeded.run.activeAttemptId!,
      toolCallId: crypto.randomUUID(),
      nativeDeliverySequence: seeded.sequence,
      bashProcessLimiter: new BashProcessLimiter(2),
      bashJobs: registry,
      jobSettings: {
        modelId: 'test-model',
        effort: 'high',
        permissionMode: 'default',
      },
      permissionPolicy: compileTestPermissionPolicy(),
      artifactReadable: true,
      artifactHostFiles: false,
    };
  });
  afterEach(async () => {
    await registry.shutdown();
    await listener?.onModuleDestroy();
    listener = undefined;
    await sql`DELETE FROM worker_instances WHERE id = ${heartbeat.instanceId}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${owner}`;
    await sql.end();
  });

  const jobs = () =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).listByChat(context.chatId, owner),
    );

  async function start(command = 'printf ready; sleep 30', unlimited = false) {
    const result = await bashTool.execute(context, {
      command,
      async: true,
      unlimited,
    });

    expect(result).toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'async',
    });

    const stored = (await jobs()).find(
      (job) => job.toolCallId === context.toolCallId,
    );

    if (stored === undefined) throw new Error('Async result has no job');
    expect(result).toMatchObject({ job: `job://bash-${stored.seq}` });

    return stored;
  }

  async function controlListener(): Promise<void> {
    const configuration = new ConfigService();
    configuration.set('POSTGRES_URL', process.env.TEST_DATABASE_URL);
    listener = new RunControlListenerService(
      new PostgresChangeListener(configuration, RUN_CONTROL_CHANNEL),
      { concurrencyFor: () => 1 },
      tenant,
      runAborts,
    );
    Object.assign(listener, { jobs: registry });
    await listener.onApplicationBootstrap();
  }

  it.each(['steer', 'interrupt'] as const)(
    'a %s sent over Postgres yields two host commands without stopping them',
    async (kind) => {
      const runId = context.runId!;
      const attemptId = crypto.randomUUID();
      await tenant.runAs(owner, (db) =>
        db.execute(
          query`UPDATE runs SET active_attempt_id = ${attemptId} WHERE id = ${runId}`,
        ),
      );
      runAborts.register(runId, owner);
      const segment = runAborts.beginSegment(runId, attemptId);

      if (segment === undefined) throw new Error('Missing active segment');
      await controlListener();
      const started = vi.spyOn(registry, 'start');

      const calls = ['first', 'second'].map((toolCallId) =>
        runTool(
          bashTool,
          { command: 'printf ready; sleep 30' },
          {
            ...context,
            attemptId,
            toolCallId,
            yieldSignal: segment.yield.signal,
          },
          30,
        ),
      );

      await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2));
      await tenant.runAs(owner, async (db) => {
        await new ChatDeliveriesRepository(db).insertPending({
          id: crypto.randomUUID(),
          chatId: context.chatId,
          ownerUserId: owner,
          mode: kind,
          parts: [{ type: 'text', text: 'change direction' }],
          settings: context.jobSettings!,
        });
        await notifyRunControl(db, { kind, runId });
      });

      const results = await Promise.all(calls);
      expect(results).toMatchObject([
        { status: 'success', backgrounded: true, cause: 'message' },
        { status: 'success', backgrounded: true, cause: 'message' },
      ]);
      expect(segment.abort.signal.aborted).toBe(kind === 'interrupt');
      expect((await jobs()).map((job) => job.state)).toEqual([
        'running',
        'running',
      ]);

      const stored = await tenant.runAs(owner, (db) =>
        new RunEventsRepository(db).listByRunId(runId, owner),
      );

      const receipts = stored.filter(
        (event) => event.eventType === 'native.result',
      );

      expect(receipts.map((event) => event.payload)).toMatchObject([
        { result: { backgrounded: true, cause: 'message' } },
        { result: { backgrounded: true, cause: 'message' } },
      ]);
      runAborts.unregister(runId);
    },
  );

  it('A build starts in the background with a durable result and starting settings', async () => {
    const job = await start();
    expect(job).toMatchObject({
      state: 'running',
      workerInstanceId: heartbeat.instanceId,
      settings: context.jobSettings,
      runId: context.runId,
    });

    const events = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.runId, context.runId!)),
    );

    expect(events.map((event) => event.eventType)).toContain('native.attempt');
    expect(
      events.find((event) => event.eventType === 'native.result')?.payload,
    ).toMatchObject({
      toolCallId: context.toolCallId,
      result: { backgrounded: true, job: `job://bash-${job.seq}` },
    });
  });

  it('A real foreground command moves at the bound with its output and keeps running', async () => {
    context = { ...context, bashBackgroundAfterSeconds: 1 };

    const result = await runTool(
      bashTool,
      { command: 'printf before; sleep 2; printf after' },
      context,
      30,
    );

    expect(result).toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'time',
    });

    const job = (await jobs()).find(
      (stored) => stored.toolCallId === context.toolCallId,
    );

    if (job === undefined) throw new Error('The move stored no job');
    expect(job.state).toBe('running');

    await vi.waitFor(
      async () => {
        expect((await jobs())[0]?.state).toBe('succeeded');
      },
      { timeout: 8000 },
    );

    const output = await tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).readOutput(owner, job.id, 'stdout'),
    );

    expect(output.toString()).toBe('beforeafter');

    const results = (
      await tenant.runAs(owner, (db) =>
        db
          .select()
          .from(schema.runEvents)
          .where(eq(schema.runEvents.runId, context.runId!)),
      )
    ).filter((event) => event.eventType === 'native.result');

    expect(results).toHaveLength(1);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'A job continues after its Run is %s (Stop after the move)',
    async (status) => {
      const abort = new AbortController();
      context = { ...context, abortSignal: abort.signal };
      const job = await start('sleep 0.2; printf retained; sleep 0.4');
      await tenant.runAs(owner, (db) =>
        new RunsRepository(db).markFinished(context.runId!, owner, status),
      );
      abort.abort();
      await vi.waitFor(async () => {
        expect((await jobs())[0]?.state).toBe('succeeded');
      });

      const output = await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).readOutput(owner, job.id, 'stdout'),
      );

      expect(output.toString()).toBe('retained');
    },
  );

  describe('the stop tool', () => {
    const stop = (jobs: Array<string>, over: Partial<ToolContext> = {}) =>
      runTool(stopTool, { jobs }, { ...context, ...over }, 30);

    it('stops a running job of this worker and reports it cancelled by the assistant', async () => {
      const job = await start('printf kept; sleep 30');
      const result = await stop([`job://bash-${job.seq}`]);

      expect(result).toEqual({
        status: 'success',
        jobs: [
          {
            job: `job://bash-${job.seq}`,
            state: 'cancelled',
            stopped_by: 'assistant',
          },
        ],
      });

      const row = (await jobs())[0];

      expect(row).toMatchObject({ state: 'cancelled', stoppedBy: 'assistant' });
      expect(row?.stopRequestedBy).toBe('assistant');
    });

    it('keeps the state of a settled job and records no request', async () => {
      const job = await start('printf done');
      await vi.waitFor(async () => {
        expect((await jobs())[0]?.state).toBe('succeeded');
      });

      await expect(stop([`JOB://bash-${job.seq}`])).resolves.toEqual({
        status: 'success',
        jobs: [{ job: `job://bash-${job.seq}`, state: 'succeeded' }],
      });
      expect((await jobs())[0]?.stopRequestedAt).toBeNull();
    });

    it('stops a job another worker hosts by polling, within the shared 5 s', async () => {
      await controlListener();

      const job = await start('sleep 30');
      // No local registry: the job is read until its own worker settles it.
      const other = stop([`job://bash-${job.seq}`], { bashJobs: undefined });

      await expect(other).resolves.toMatchObject({
        jobs: [{ state: 'cancelled', stopped_by: 'assistant' }],
      });
    });

    it('reports running with the recorded request once, under one shared 5 s for two jobs', async () => {
      const other = crypto.randomUUID();

      await sql`INSERT INTO worker_instances (id) VALUES (${other})`;

      try {
        const first = await start('sleep 30');
        context = { ...context, toolCallId: crypto.randomUUID() };
        const second = await start('sleep 30');

        await sql`UPDATE chat_jobs SET worker_instance_id = ${other} WHERE id IN (${first.id}, ${second.id})`;

        const started = Date.now();

        const result = await stop(
          [`job://bash-${first.seq}`, `job://bash-${second.seq}`],
          { bashJobs: undefined },
        );

        const elapsed = Date.now() - started;

        // One budget for both jobs: not 5 s each.
        expect(elapsed).toBeGreaterThanOrEqual(4900);
        expect(elapsed).toBeLessThan(8000);
        expect(result).toEqual({
          status: 'success',
          jobs: [
            { job: `job://bash-${first.seq}`, state: 'running' },
            { job: `job://bash-${second.seq}`, state: 'running' },
          ],
        });
        expect((await jobs()).map((job) => job.stopRequestedBy)).toEqual([
          'assistant',
          'assistant',
        ]);
      } finally {
        await sql`UPDATE chat_jobs SET worker_instance_id = ${heartbeat.instanceId} WHERE worker_instance_id = ${other}`;
        await sql`DELETE FROM worker_instances WHERE id = ${other}`;
      }
    }, 20_000);

    it('keeps the stopper of the request that came first', async () => {
      const job = await start('sleep 30');

      await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).requestStop(
          context.chatId,
          owner,
          job.id,
          'owner',
        ),
      );

      await expect(stop([`job://bash-${job.seq}`])).resolves.toEqual({
        status: 'success',
        jobs: [
          {
            job: `job://bash-${job.seq}`,
            state: 'cancelled',
            stopped_by: 'owner',
          },
        ],
      });
      expect((await jobs())[0]).toMatchObject({
        stoppedBy: 'owner',
        stopRequestedBy: 'owner',
      });
    });

    it('refuses the whole call when one locator is unknown, before any request', async () => {
      const job = await start('sleep 30');
      const result = await stop([`job://bash-${job.seq}`, 'job://bash-9999']);

      expect(result).toMatchObject({ status: 'error', type: 'not_found' });
      expect((await jobs())[0]).toMatchObject({
        state: 'running',
        stopRequestedAt: null,
      });
    });

    it('A tool call cannot name a job of another owner', async () => {
      const job = await start('sleep 30');
      const intruder = crypto.randomUUID();

      await sql`INSERT INTO users(id,name,email) VALUES (${intruder}, 'Other', ${`${intruder}@test.com`})`;

      try {
        const other = await tenant.runAs(intruder, (db) =>
          new ChatsRepository(db).create({
            ownerUserId: intruder,
            title: 'Other chat',
          }),
        );

        // The intruder's Run names a locator that only resolves in the first Chat.
        const result = await stop([`job://bash-${job.seq}`], {
          userId: intruder,
          chatId: other.id,
        });

        expect(result).toMatchObject({ status: 'error', type: 'not_found' });
        expect((await jobs())[0]).toMatchObject({
          state: 'running',
          stopRequestedAt: null,
        });
      } finally {
        await sql`DELETE FROM users WHERE id = ${intruder}`;
      }
    });

    it.each([[['job://bash-1/stdout']], [['artifact://bash-1']], [['x']]])(
      'refuses %j as an invalid locator',
      async (jobsInput) => {
        await expect(stop(jobsInput)).resolves.toMatchObject({
          type: 'invalid_input',
        });
      },
    );
  });

  it('an operator-enabled unlimited job stores no deadline', async () => {
    context = { ...context, allowUnlimitedJobs: true };
    expect((await start('sleep 30', true)).deadlineAt).toBeNull();
  });

  it('A stop from the API reaches a dedicated worker; The owner stops one of two jobs', async () => {
    await controlListener();
    const first = await start();
    context = { ...context, toolCallId: crypto.randomUUID() };
    const second = await start();
    await new ChatJobsService(tenant, config, {
      wakeForChatInTransaction: () => Promise.resolve(false),
    }).stop(context.chatId, first.id, owner);
    await vi.waitFor(async () => {
      expect((await jobs()).find((job) => job.id === first.id)).toMatchObject({
        state: 'cancelled',
        stoppedBy: 'owner',
      });
    });
    expect((await jobs()).find((job) => job.id === second.id)?.state).toBe(
      'running',
    );
    expect(() => process.kill(-first.pid!, 0)).toThrow('ESRCH');
  });

  it('a pointer without a recorded request cannot stop a job', async () => {
    await controlListener();
    const job = await start();
    await tenant.runAs(owner, (db) =>
      notifyRunControl(db, { kind: 'job-stop', jobId: job.id }),
    );
    await registry.recheckJob(job.id);
    expect((await jobs())[0]?.state).toBe('running');
  });

  it('a lost signal is recovered by the heartbeat in the job owner scope', async () => {
    const job = await start();
    await tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).requestStop(
        context.chatId,
        owner,
        job.id,
        'owner',
      ),
    );
    await heartbeat.beat();
    expect((await jobs())[0]).toMatchObject({
      state: 'cancelled',
      stoppedBy: 'owner',
    });
    expect(() => process.kill(-job.pid!, 0)).toThrow('ESRCH');
  });

  it('a resumed worker stops work already settled as lost without rewriting its result', async () => {
    const job = await start();
    await sql`
      UPDATE worker_instances
      SET last_seen_at = now() - interval '1 hour'
      WHERE id = ${heartbeat.instanceId}
    `;
    await tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).settleOnDeadWorkers(context.chatId, owner, 60),
    );
    const lost = (await jobs())[0];
    expect(lost?.state).toBe('lost');
    expect(() => process.kill(-job.pid!, 0)).not.toThrow();

    await heartbeat.beat();

    expect(() => process.kill(-job.pid!, 0)).toThrow('ESRCH');
    expect((await jobs())[0]).toEqual(lost);
  });

  it('the heartbeat commits a natural exit after a transient settlement failure', async () => {
    const settle = vi
      .spyOn(ChatJobsRepository.prototype, 'settle')
      .mockRejectedValue(new Error('settlement unavailable'));

    try {
      const job = await start('sleep 0.2; printf recovered');

      await vi.waitFor(() => {
        expect(settle).toHaveBeenCalled();
      });
      expect((await jobs())[0]?.state).toBe('running');
      settle.mockRestore();
      await heartbeat.beat();
      expect((await jobs())[0]?.state).toBe('succeeded');

      const output = await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).readOutput(owner, job.id, 'stdout'),
      );

      expect(output.toString()).toBe('recovered');
    } finally {
      settle.mockRestore();
    }
  });

  it('A deleted Chat leaves no process', async () => {
    await controlListener();
    const job = await start();

    const chats = new ChatsService(
      tenant,
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      { wakeInTransaction: () => Promise.resolve(false) } satisfies Pick<
        RunWaitService,
        'wakeInTransaction'
      >,
    );

    expect(await chats.deleteChat(owner, context.chatId)).toBe(true);
    await vi.waitFor(() => {
      expect(() => process.kill(-job.pid!, 0)).toThrow('ESRCH');
    });
    expect(await jobs()).toEqual([]);
  });
});
