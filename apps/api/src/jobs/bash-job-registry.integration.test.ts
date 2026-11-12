import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import {
  type BashResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopResult,
} from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { FakeModelsService } from '../testing/fake-streaming-model-client';
import { JobNoticeRunService } from '../runs/job-notice-run.service';
import { readJob } from './job-reader';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { BashJobRegistry, type BashJobFacts } from './bash-job-registry';
import { JobPromotionError } from './job-promotion-error';
import { type TenantRunner } from '../db/tenant-db.service';
import { ChatJobsRepository } from './chat-jobs.repository';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

class Command implements ManagedBashHandle {
  readonly pid = 12_345;
  private readonly result = Promise.withResolvers<BashResult>();
  readonly settled = this.result.promise;
  private listeners = new Set<(bytes: number) => void>();
  private output: ManagedOutput = {
    stdout: '',
    stderr: '',
    truncated: false,
    truncatedStreams: { stdout: false, stderr: false },
  };
  readonly stop = vi.fn((cause: string): Promise<ManagedStopResult> => {
    this.result.resolve({ status: 'error', type: 'cancelled', message: cause });

    return Promise.resolve({ ...this.output, proved: this.proved });
  });
  proved = true;
  snapshot(): ManagedOutput {
    return this.output;
  }
  onOutput(listener: (bytes: number) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
  cut(stream: 'stdout' | 'stderr'): void {
    this.output = {
      ...this.output,
      truncated: true,
      truncatedStreams: { ...this.output.truncatedStreams, [stream]: true },
    };
  }
  print(text: string): void {
    this.output = { ...this.output, stdout: this.output.stdout + text };

    for (const listener of this.listeners) listener(Buffer.byteLength(text));
  }
  exit(code: number, signal?: NodeJS.Signals): void {
    this.result.resolve({
      status: code === 0 ? 'success' : 'error',
      exitCode: code,
      signal,
      ...this.output,
    });
  }
  lost(): void {
    this.result.resolve({
      status: 'error',
      type: 'outcome_unknown',
      attemptId: 'unknown',
      message: 'Unknown.',
    });
  }
}

const config: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };

const noticeRuns = new JobNoticeRunService(new FakeModelsService(), config, {
  enqueueInTransaction: async () => {},
});

describe('BashJobRegistry', () => {
  let client: Sql;
  let tenant: TenantDbService;
  let owner: string;
  let worker: Pick<WorkerHeartbeatService, 'instanceId'>;
  let registry: BashJobRegistry;
  let facts: BashJobFacts;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;

    if (!url) {
      throw new Error(
        'bash-job-registry.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
      );
    }

    client = postgres(url, { max: 5 });
    tenant = new TenantDbService(drizzle(client, { schema }));
    owner = crypto.randomUUID();
    worker = { instanceId: crypto.randomUUID() };
    await client`INSERT INTO users (id,name,email) VALUES (${owner}, 'Runtime', ${`${owner}@test.com`})`;
    await client`INSERT INTO worker_instances (id) VALUES (${worker.instanceId})`;
  });
  beforeEach(async () => {
    registry = new BashJobRegistry(tenant, worker, config, noticeRuns);

    const chat = await tenant.runAs(owner, (db) =>
      new ChatsRepository(db).create({
        ownerUserId: owner,
        title: 'Job runtime',
      }),
    );

    facts = {
      ownerUserId: owner,
      chatId: chat.id,
      runId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      startedAt: new Date(),
      settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
      maxBytes: 65_536,
      configuredCredentials: [],
      artifactReadable: true,
      hostFiles: false,
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    await registry.shutdown();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await client`DELETE FROM users WHERE id = ${owner}`;
    await client`DELETE FROM worker_instances WHERE id = ${worker.instanceId}`;
    await client.end();
  });

  const row = (id: string) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).findById(facts.chatId, owner, id),
    );

  const output = (id: string) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).readOutput(owner, id, 'stdout'),
    );

  async function ended(id: string, state: string): Promise<void> {
    await vi.waitFor(async () => {
      expect((await row(id))?.state).toBe(state);
    });
  }

  it('a worker heartbeat stops a real command from its durable owner request', async () => {
    const heartbeat = new WorkerHeartbeatService(
      drizzle(client, { schema }),
      config,
      { concurrencyFor: () => 1 },
    );

    registry = new BashJobRegistry(tenant, heartbeat, config, noticeRuns);
    registry.onModuleInit();
    await heartbeat.beat();

    try {
      const handle = registry.start(
        { command: 'bash', args: ['-c', 'sleep 30'], cwd: '/tmp', env: {} },
        {
          workingDirectory: '/tmp',
          secretBoundary: true,
          processIsolation: true,
          outputBoundBytes: 1_000_000,
          inputBound: 8000,
          durationMs: 300_000,
          maxProcesses: 4,
        },
      );

      if (!('pid' in handle)) throw new Error('The command did not start.');
      const job = await registry.promote(handle, facts);
      await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).requestStop(
          facts.chatId,
          owner,
          job.id,
          'owner',
        ),
      );

      await heartbeat.beat();

      expect(await row(job.id)).toMatchObject({
        state: 'cancelled',
        stoppedBy: 'owner',
      });
      expect(() => process.kill(-handle.pid, 0)).toThrow('ESRCH');
    } finally {
      await registry.shutdown();
      await client`DELETE FROM worker_instances WHERE id = ${heartbeat.instanceId}`;
    }
  });

  it('keeps the starting Run facts and output at promotion', async () => {
    const command = new Command();
    command.print('before promotion\n');
    const job = await registry.promote(command, facts);
    expect(job).toMatchObject({
      runId: facts.runId,
      toolCallId: facts.toolCallId,
      workerInstanceId: worker.instanceId,
      pid: 12_345,
      settings: facts.settings,
      artifactReadable: true,
    });
    expect(job.deadlineAt!.getTime() - facts.startedAt.getTime()).toBe(
      7_200_000,
    );
    expect((await output(job.id)).toString()).toBe('before promotion\n');
  });

  it('stops a command when its promotion fails', async () => {
    const command = new Command();
    command.print('seen before the failure');

    const failure = await registry
      .promote(command, { ...facts, chatId: crypto.randomUUID() })
      .catch((error: unknown) => error);

    if (!(failure instanceof JobPromotionError))
      throw new Error('Expected a promotion error');

    expect(failure.stopped).toMatchObject({
      proved: true,
      stdout: 'seen before the failure',
    });
    expect(failure.cause).toMatchObject({
      message: 'The Chat cannot store an artifact.',
    });
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('marks only the stream that passed the bound as truncated', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('x');
    command.cut('stdout');
    command.exit(0);
    await ended(job.id, 'succeeded');
    expect((await row(job.id))?.result?.truncated).toEqual({
      stdout: true,
      stderr: false,
    });
  });

  it('keeps a failed settlement and commits it on the next recheck', async () => {
    let down = false;

    const flaky: TenantRunner = {
      runAs: (userId, callback) =>
        down
          ? Promise.reject(new Error('db down'))
          : tenant.runAs(userId, callback),
    };

    const flakyRegistry = new BashJobRegistry(
      flaky,
      worker,
      config,
      noticeRuns,
    );

    const failing = new Command();
    const healthy = new Command();
    const job = await flakyRegistry.promote(failing, facts);
    const other = await flakyRegistry.promote(healthy, facts);
    failing.print('kept output');
    down = true;
    // Shutdown stays bounded and awaits every stop even though the database is down.
    await expect(flakyRegistry.shutdown()).resolves.toBeUndefined();
    expect(failing.stop).toHaveBeenCalledWith('worker');
    expect(healthy.stop).toHaveBeenCalledWith('worker');
    expect((await row(job.id))?.state).toBe('running');
    down = false;
    await flakyRegistry.settlePending();
    expect(await row(job.id)).toMatchObject({
      state: 'cancelled',
      stoppedBy: 'worker',
    });
    expect((await output(job.id)).toString()).toBe('kept output');
    expect((await row(other.id))?.state).toBe('cancelled');
    // Nothing is left pending after the commit.
    await expect(flakyRegistry.settlePending()).resolves.toBeUndefined();
  });

  it('keeps a dead worker settlement lost when its old commit resumes', async () => {
    const instanceId = crypto.randomUUID();
    let down = false;
    let failures = 0;

    const flaky: TenantRunner = {
      runAs: (userId, callback) => {
        if (down) {
          failures++;

          return Promise.reject(new Error('db down'));
        }

        return tenant.runAs(userId, callback);
      },
    };

    const oldRegistry = new BashJobRegistry(
      flaky,
      { instanceId },
      config,
      noticeRuns,
    );

    const command = new Command();

    await client`INSERT INTO worker_instances (id) VALUES (${instanceId})`;

    try {
      command.print('stored before exit');
      const job = await oldRegistry.promote(command, facts);
      down = true;
      command.exit(0);
      await vi.waitFor(() => expect(failures).toBeGreaterThan(0));
      await client`DELETE FROM worker_instances WHERE id = ${instanceId}`;
      down = false;
      await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).settleOnDeadWorkers(
          facts.chatId,
          owner,
          120,
        ),
      );
      await oldRegistry.settlePending();
      expect(await row(job.id)).toMatchObject({
        state: 'lost',
        result: { outcomeUnknown: true },
      });
      expect((await output(job.id)).toString()).toBe('stored before exit');
    } finally {
      down = false;
      await oldRegistry.shutdown();
      await client`DELETE FROM worker_instances WHERE id = ${instanceId}`;
    }
  });

  it('A quiet job writes nothing', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    await vi.advanceTimersByTimeAsync(600_000);
    vi.useRealTimers();
    expect((await output(job.id)).length).toBe(0);

    const chunks = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.chatJobChunks)
        .where(eq(schema.chatJobChunks.jobId, job.id)),
    );

    expect(chunks).toEqual([]);
  });

  it('A stored line is readable two seconds later; A resumed Run on another worker reads a job', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    command.print('stored line\n');
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect((await output(job.id)).toString()).toBe('stored line\n');
    });

    const read = await readJob(
      {
        userId: owner,
        chatId: facts.chatId,
        tenantDb: tenant,
        configuredCredentials: [],
        permissionPolicy: compileTestPermissionPolicy(),
      },
      'read',
      `job://bash-${job.seq}/stdout`,
    );

    expect(JSON.stringify(read)).toContain('stored line');
  });

  it('A credential across two increments with the cut inside the value', async () => {
    const secret = 'provider-key-secret-123456789';
    const prefix = 'a'.repeat(16_380);

    const handle = registry.start(
      {
        command: 'bash',
        args: [
          '-c',
          `printf '%s' '${prefix}${secret.slice(0, 10)}'; sleep 1.5; printf '%s' '${secret.slice(10)}'; sleep 0.1`,
        ],
      },
      {
        workingDirectory: process.cwd(),
        secretBoundary: true,
        processIsolation: true,
        inputBound: 32_768,
        outputBoundBytes: 65_536,
        durationMs: 1,
        maxProcesses: 1,
      },
      { protectedValues: [secret] },
    );

    if (!('pid' in handle)) throw new Error('Command did not start');

    const job = await registry.promote(handle, {
      ...facts,
      artifactReadable: false,
      configuredCredentials: [secret],
    });

    await vi.waitFor(
      async () => {
        expect((await output(job.id)).toString()).toBe(prefix);
      },
      { timeout: 1400 },
    );
    await handle.settled;
    await ended(job.id, 'succeeded');
    const stored = (await output(job.id)).toString();
    expect(stored).toBe(`${prefix}[REDACTED]`);
    expect(stored).not.toContain(secret.slice(0, 10));
  });

  it.each([
    [0, 'succeeded'],
    [2, 'failed'],
  ] as const)(
    'A failing build settles as failed (exit %s)',
    async (code, state) => {
      const command = new Command();
      const job = await registry.promote(command, facts);
      command.print('build\n');
      command.exit(code);
      await ended(job.id, state);
      expect((await row(job.id))?.result?.exitCode).toBe(code);
      expect((await output(job.id)).toString()).toBe('build\n');
    },
  );

  it('records the signal that ends a command', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.exit(1, 'SIGTERM');
    await ended(job.id, 'failed');
    expect((await row(job.id))?.result).toMatchObject({
      signal: 'SIGTERM',
      exitCode: null,
    });
  });

  it('A survivor makes the outcome unknown', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('kept');
    command.lost();
    await ended(job.id, 'lost');
    expect((await row(job.id))?.result?.outcomeUnknown).toBe(true);
    expect((await output(job.id)).toString()).toBe('kept');
  });

  it('persists an executor-owned lifetime stop and its captured output', async () => {
    registry = new BashJobRegistry(tenant, worker, {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          ...BUILT_IN_DEFAULTS.tools,
          jobs: { ...BUILT_IN_DEFAULTS.tools.jobs, maxSeconds: 0.5 },
        },
      },
    });

    const command = registry.start(
      {
        command: 'bash',
        args: ['-c', 'printf "before lifetime"; sleep 30'],
        cwd: '/tmp',
      },
      {
        workingDirectory: '/tmp',
        secretBoundary: true,
        processIsolation: true,
        outputBoundBytes: 65_536,
        inputBound: 8000,
        durationMs: 300_000,
        maxProcesses: 1,
      },
    );

    if (!('pid' in command)) throw new Error('Command did not start');
    const job = await registry.promote(command, facts);
    await command.settled;
    await ended(job.id, 'timed_out');
    expect((await output(job.id)).toString()).toBe('before lifetime');
  });

  it('A stop that is not proved keeps output and settles lost rather than cancelled', async () => {
    const command = new Command();
    command.proved = false;
    const job = await registry.promote(command, facts);
    command.print('before owner stop');
    await tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).requestStop(
        facts.chatId,
        owner,
        job.id,
        'owner',
      ),
    );
    await registry.recheckJob(job.id);
    expect(await row(job.id)).toMatchObject({
      state: 'lost',
      result: { outcomeUnknown: true },
    });
    expect((await output(job.id)).toString()).toBe('before owner stop');
  });
  it('A deploy ends a job and refuses later commands and promotions', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('before deploy');
    await registry.shutdown();
    expect(await row(job.id)).toMatchObject({
      state: 'cancelled',
      stoppedBy: 'worker',
    });
    expect((await output(job.id)).toString()).toBe('before deploy');
    const late = new Command();
    await expect(registry.promote(late, facts)).rejects.toMatchObject({
      cause: { message: 'The worker is shutting down.' },
    });
    expect(late.stop).toHaveBeenCalledWith('run');
    expect(
      registry.start(
        { command: 'bash' },
        {
          workingDirectory: process.cwd(),
          secretBoundary: true,
          processIsolation: true,
          inputBound: 512,
          outputBoundBytes: 65_536,
          durationMs: 1,
          maxProcesses: 1,
        },
      ),
    ).toMatchObject({ type: 'unavailable' });
  });
});
