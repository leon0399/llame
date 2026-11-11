import { type BashResult } from '@workspace/bash-executor';

import { type ChatJob } from '../db/schema';
import { type MockInstance } from 'vitest';
import { type Db } from '../db/tenant-db.service';
import { type WorkerHeartbeatService } from './worker-heartbeat.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { ChatsRepository } from '../chats/chats-repository';
import { BashJobRegistry, type BashJobFacts } from './bash-job-registry';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';

// SAFETY: the fake implements only the members the runtime calls.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const asDb = (fake: { insert: unknown }): Db => fake as never;

const facts: BashJobFacts = {
  ownerUserId: 'owner',
  chatId: 'chat',
  runId: 'run',
  toolCallId: 'call',
  startedAt: new Date('2026-11-11T10:00:00.000Z'),
  settings: { modelId: 'm', permissionMode: 'default' },
  maxBytes: 1_000_000,
  configuredCredentials: [],
  artifactReadable: false,
  hostFiles: false,
};

function command() {
  let finish: (result: BashResult) => void = () => {};
  const settled = new Promise<BashResult>((resolve) => (finish = resolve));

  const stop = vi.fn((_cause: string) =>
    Promise.resolve({
      proved: true,
      stdout: '',
      stderr: '',
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    }),
  );

  return {
    // SAFETY: the registry uses only these members.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    handle: {
      pid: 1,
      settled,
      snapshot: () => ({
        stdout: '',
        stderr: '',
        truncated: false,
        truncatedStreams: { stdout: false, stderr: false },
      }),
      onOutput: () => () => undefined,
      stop,
    } as never,
    stop,
    finish,
  };
}

describe('the heartbeat check of live jobs', () => {
  let rows: Map<string, Partial<ChatJob> | undefined>;
  let lookups: Array<string>;
  let settlements: Array<JobSettlement>;
  let registry: BashJobRegistry;
  let ids: number;
  let findById: MockInstance<ChatJobsRepository['findById']>;
  let settle: MockInstance<ChatJobsRepository['settle']>;
  let worker: Pick<WorkerHeartbeatService, 'instanceId' | 'jobCheck'>;

  beforeEach(() => {
    rows = new Map();
    lookups = [];
    settlements = [];
    ids = 0;

    const db = {
      transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
      insert: () => ({ values: () => Promise.resolve() }),
    };

    worker = { instanceId: crypto.randomUUID() };

    registry = new BashJobRegistry(
      { runAs: <T>(_o: string, fn: (tx: Db) => Promise<T>) => fn(asDb(db)) },
      worker,
      { config: BUILT_IN_DEFAULTS },
    );
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(7);
    // SAFETY: only presence is checked.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue({} as never);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockImplementation((job) =>
      // SAFETY: the row echoes the inserted fields.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      Promise.resolve({
        ...job,
        id: `job-${++ids}`,
        deadlineAt: null,
      } as never),
    );
    findById = vi
      .spyOn(ChatJobsRepository.prototype, 'findById')
      .mockImplementation((_chat, _owner, id) => {
        lookups.push(id);

        // SAFETY: a stored row, as far as the check reads it.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        return Promise.resolve(rows.get(id) as ChatJob | undefined);
      });
    settle = vi
      .spyOn(ChatJobsRepository.prototype, 'settle')
      .mockImplementation((_c, _o, _j, settlement) => {
        settlements.push(settlement);

        // SAFETY: the store checks only that a row came back.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        return Promise.resolve({} as ChatJob);
      });
  });
  afterEach(async () => {
    await registry.shutdown();
    vi.restoreAllMocks();
  });

  async function live() {
    const c = command();
    const job = await registry.promote(c.handle, facts);

    return { ...c, id: job.id };
  }

  it('stops with the stored stopper when a stop was requested', async () => {
    const job = await live();

    rows.set(job.id, { state: 'running', stopRequestedBy: 'assistant' });
    await registry.recheckJob(job.id);

    expect(job.stop).toHaveBeenCalledWith('assistant');
    expect(settlements).toMatchObject([
      { state: 'cancelled', stoppedBy: 'assistant' },
    ]);
  });

  it('stops for the owner when the job row is gone', async () => {
    const job = await live();

    await registry.recheckJob(job.id);

    expect(job.stop).toHaveBeenCalledWith('owner');
  });

  it('stops for the worker when the row is already settled elsewhere', async () => {
    const job = await live();

    rows.set(job.id, { state: 'lost', stopRequestedBy: null });
    await registry.recheckJob(job.id);

    expect(job.stop).toHaveBeenCalledWith('worker');
  });

  it('leaves a healthy running job alone', async () => {
    const job = await live();

    rows.set(job.id, { state: 'running', stopRequestedBy: null });
    await registry.recheckJob(job.id);

    expect(job.stop).not.toHaveBeenCalled();
    expect(settlements).toEqual([]);
  });

  it('reads nothing for a job this worker does not hold', async () => {
    await registry.recheckJob('unknown');

    expect(lookups).toEqual([]);
  });

  it('keeps checking the healthy and the stop-requested jobs after one lookup fails', async () => {
    const a = await live();
    const b = await live();
    const c = await live();

    rows.set(b.id, { state: 'running', stopRequestedBy: null });
    rows.set(c.id, { state: 'running', stopRequestedBy: 'owner' });
    findById.mockImplementationOnce(() => Promise.reject(new Error('db down')));

    await expect(registry.recheckJobs()).resolves.toBeUndefined();

    expect(lookups).toEqual([b.id, c.id]);
    expect(a.stop).not.toHaveBeenCalled();
    expect(b.stop).not.toHaveBeenCalled();
    expect(c.stop).toHaveBeenCalledWith('owner');
  });

  it('observes an owner stop through the registered heartbeat callback', async () => {
    const job = await live();

    rows.set(job.id, { state: 'running', stopRequestedBy: 'owner' });
    registry.onModuleInit();
    await worker.jobCheck?.();

    expect(job.stop).toHaveBeenCalledWith('owner');
    expect(settlements).toMatchObject([
      { state: 'cancelled', stoppedBy: 'owner' },
    ]);
  });

  it('does not read job rows when shutdown starts during a heartbeat check', async () => {
    const job = await live();
    rows.set(job.id, { state: 'running', stopRequestedBy: null });
    let release: () => void = () => {};
    const stopping = new Promise<void>((resolve) => (release = resolve));

    job.stop.mockImplementationOnce(async () => {
      await stopping;

      return {
        proved: true,
        stdout: '',
        stderr: '',
        truncated: false,
        truncatedStreams: { stdout: false, stderr: false },
      };
    });
    const checking = registry.recheckJobs();
    const shutdown = registry.shutdown();

    try {
      await checking;
      expect(lookups).toEqual([]);
    } finally {
      release();
      await shutdown;
    }

    expect(settlements).toMatchObject([
      { state: 'cancelled', stoppedBy: 'worker' },
    ]);
  });

  it('leaves failed settlement retry to shutdown once the worker stops accepting', async () => {
    const job = await live();

    settle.mockRejectedValue(new Error('db down'));
    await expect(registry.stop(job.id, 'owner')).rejects.toThrow('db down');
    await registry.shutdown();
    settle.mockClear();

    await registry.recheckJobs();

    expect(settle).not.toHaveBeenCalled();
    expect(lookups).toEqual([]);
  });

  it('retries a settlement that failed before it looks at the jobs', async () => {
    const job = await live();

    settle.mockRejectedValueOnce(new Error('db down'));
    job.finish({
      status: 'success',
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
    });
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
    await registry.recheckJobs();

    expect(settlements).toMatchObject([{ state: 'succeeded' }]);
  });

  it('checks nothing once the worker is shutting down', async () => {
    const job = await live();

    await registry.shutdown();
    lookups.length = 0;
    await registry.recheckJobs();

    expect(lookups).toEqual([]);
    expect(job.stop).toHaveBeenCalledWith('worker');
  });
});
