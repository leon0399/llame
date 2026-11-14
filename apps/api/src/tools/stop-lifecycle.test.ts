import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { isString } from '@workspace/runtime-safety';

import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { RunsRepository } from '../runs/runs-repository';
import { ChatsRepository } from '../chats/chats-repository';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { parseRunControl, RUN_CONTROL_CHANNEL } from '../runs/run-control';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { managedBashContext } from './bash-limits';
import { stopTool } from './stop';
import { type ToolContext } from './types';

function job(seq: number, state: ChatJob['state'] = 'running'): ChatJob {
  return {
    id: `job-${seq}`,
    chatId: 'chat',
    ownerUserId: 'owner',
    executor: 'bash',
    seq,
    state,
    stoppedBy: null,
    runId: 'run',
    toolCallId: `call-${seq}`,
    workerInstanceId: 'worker',
    pid: 1,
    startedAt: new Date(),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: ['stdout', 'stderr'],
    artifactId: null,
    artifactReadable: false,
    settings: { modelId: 'm', permissionMode: 'default' },
  };
}

describe('stop lifecycle', () => {
  let rows: Map<string, ChatJob>;
  let clock: number;
  let registry: BashJobRegistry;
  let context: ToolContext;
  let firstCommit: Promise<void> | undefined;
  let beforeCommit: (() => void) | undefined;
  let onRead: (() => void) | undefined;
  let afterDeadWorkerCheck: (() => void) | undefined;
  let deliverNotification: ((raw: string) => Promise<void>) | undefined;

  beforeEach(() => {
    rows = new Map();
    clock = 0;
    firstCommit = undefined;
    beforeCommit = undefined;
    onRead = undefined;
    afterDeadWorkerCheck = undefined;
    deliverNotification = undefined;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const dialect = new PgDialect();
    const notifications: Array<string> = [];

    const fakeDb = {
      execute: (query: SQL) => {
        const [channel, payload]: ReadonlyArray<unknown> =
          dialect.sqlToQuery(query).params;

        if (channel === RUN_CONTROL_CHANNEL && isString(payload))
          notifications.push(payload);

        return Promise.resolve([]);
      },
      transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(db),
    };

    // SAFETY: repository methods are stubbed; only execute and transaction run.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const db: Db = fakeDb as never;

    let first = true;

    const tenantDb: ToolContext['tenantDb'] = {
      runAs: async <T>(_owner: string, fn: (tx: Db) => Promise<T>) => {
        const waitForCommit = first ? firstCommit : undefined;
        first = false;
        const result = await fn(db);

        if (waitForCommit !== undefined) beforeCommit?.();
        await waitForCommit;

        for (const raw of notifications.splice(0))
          await deliverNotification?.(raw);

        return result;
      },
    };

    registry = new BashJobRegistry(
      tenantDb,
      { instanceId: crypto.randomUUID() },
      { config: BUILT_IN_DEFAULTS },
      { startOnSettlement: vi.fn() },
    );
    context = {
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call',
      nativeExecutorId: 'host',
      configuredCredentials: [],
      tenantDb,
    };
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'insertJobNotice',
    ).mockResolvedValue(undefined);
    vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
      undefined,
    );
    vi.spyOn(
      ChatJobsRepository.prototype,
      'settleOnDeadWorkers',
    ).mockImplementation(() => {
      afterDeadWorkerCheck?.();

      return Promise.resolve([]);
    });
    vi.spyOn(ChatJobsRepository.prototype, 'findByLocator').mockImplementation(
      (_chat, _owner, executor, seq) => {
        const row = rows.get(`job-${seq}`);

        return Promise.resolve(
          row?.executor === executor ? { ...row } : undefined,
        );
      },
    );
    vi.spyOn(ChatJobsRepository.prototype, 'requestStop').mockImplementation(
      (_chat, _owner, id, by) => {
        const row = rows.get(id);

        if (row === undefined || row.state !== 'running')
          return Promise.resolve(undefined);
        row.stopRequestedBy ??= by;
        row.stopRequestedAt ??= new Date();

        return Promise.resolve({ ...row });
      },
    );
    vi.spyOn(ChatJobsRepository.prototype, 'findById').mockImplementation(
      (_chat, _owner, id) => {
        onRead?.();
        const row = rows.get(id);

        return Promise.resolve(row === undefined ? undefined : { ...row });
      },
    );
  });
  afterEach(async () => {
    await registry.shutdown();
    vi.restoreAllMocks();
  });

  it('resolves every locator before recording any request', async () => {
    rows.set('job-1', job(1));

    await expect(
      stopTool.execute(context, { jobs: ['job://bash-1', 'job://bash-99'] }),
    ).resolves.toMatchObject({ status: 'error', type: 'not_found' });
    expect(rows.get('job-1')?.stopRequestedAt).toBeNull();
  });

  it('reports a job lost by the admission touch without requesting a stop', async () => {
    const row = job(1);
    rows.set(row.id, row);
    afterDeadWorkerCheck = () => {
      row.state = 'lost';
    };

    await expect(
      stopTool.execute(context, { jobs: ['job://bash-1'] }),
    ).resolves.toMatchObject({
      status: 'success',
      jobs: [{ state: 'lost' }],
    });
    expect(row.stopRequestedAt).toBeNull();
  });

  it('keeps terminal states and does not overwrite the stopper', async () => {
    const row = job(1, 'cancelled');
    row.stoppedBy = 'owner';
    rows.set(row.id, row);

    await expect(
      stopTool.execute(context, { jobs: ['job://bash-1'] }),
    ).resolves.toEqual({
      status: 'success',
      jobs: [{ job: 'job://bash-1', state: 'cancelled', stopped_by: 'owner' }],
    });
    expect(row.stopRequestedAt).toBeNull();
  });

  it('starts one shared five-second window after request commit', async () => {
    const commit = Promise.withResolvers<void>();
    const readyToCommit = Promise.withResolvers<void>();
    const reading = Promise.withResolvers<void>();
    rows.set('job-1', job(1));
    rows.set('job-2', job(2));
    firstCommit = commit.promise;
    beforeCommit = () => readyToCommit.resolve();
    onRead = () => reading.resolve();
    let returned = false;

    const call = Promise.resolve(
      stopTool.execute(context, { jobs: ['job://bash-1', 'job://bash-2'] }),
    );

    void call.then(() => {
      returned = true;
    });

    await readyToCommit.promise;
    clock = 10_000;
    commit.resolve();
    await reading.promise;
    clock = 14_999;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(false);
    clock = 15_000;

    await expect(call).resolves.toEqual({
      status: 'success',
      jobs: [
        { job: 'job://bash-1', state: 'running' },
        { job: 'job://bash-2', state: 'running' },
      ],
    });
    expect([...rows.values()].map((row) => row.stopRequestedBy)).toEqual([
      'assistant',
      'assistant',
    ]);
  });

  it('continues polling until every listed remote job settles', async () => {
    const first = job(1);
    const second = job(2);
    const observed = Promise.withResolvers<void>();
    rows.set(first.id, first);
    rows.set(second.id, second);
    onRead = () => {
      if (first.state === 'succeeded') observed.resolve();
    };

    const call = stopTool.execute(context, {
      jobs: ['job://bash-1', 'job://bash-2'],
    });

    first.state = 'succeeded';
    await observed.promise;
    second.state = 'failed';
    await expect(call).resolves.toMatchObject({
      jobs: [{ state: 'succeeded' }, { state: 'failed' }],
    });
  });

  it('falls back to stored state when a local recheck fails', async () => {
    const row = job(1);
    const reading = Promise.withResolvers<void>();
    rows.set(row.id, row);
    onRead = () => reading.resolve();
    vi.spyOn(registry, 'recheckJob').mockRejectedValueOnce(
      new Error('worker busy'),
    );

    const call = stopTool.execute(
      { ...context, bashJobs: registry },
      { jobs: ['job://bash-1'] },
    );

    await reading.promise;
    clock = 5000;
    await expect(call).resolves.toMatchObject({ jobs: [{ state: 'running' }] });
    expect(row.stopRequestedBy).toBe('assistant');
  });

  it.each(['local', 'notification'] as const)(
    'uses the first stopper to settle a real command through %s',
    async (route) => {
      vi.spyOn(performance, 'now').mockRestore();
      vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
      // SAFETY: the settlement only needs to know that the Chat still exists.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      const existingChat = { id: 'chat' } as never;

      vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
        existingChat,
      );
      vi.spyOn(ChatJobsRepository.prototype, 'insert').mockImplementation(
        (inserted) => {
          const row: ChatJob = {
            ...job(inserted.seq),
            ...inserted,
            outputs: [...inserted.outputs],
            deadlineAt: inserted.deadlineAt ?? null,
          };

          rows.set(row.id, row);

          return Promise.resolve({ ...row });
        },
      );
      vi.spyOn(ChatJobsRepository.prototype, 'settle').mockImplementation(
        (_chat, _owner, id, settlement) => {
          const row = rows.get(id);

          if (row === undefined || row.state !== 'running')
            return Promise.resolve(undefined);
          row.state = settlement.state;
          row.stoppedBy =
            settlement.state === 'cancelled' ? settlement.stoppedBy : null;

          return Promise.resolve({ ...row });
        },
      );

      const handle = registry.start(
        { command: 'bash', args: ['-c', 'sleep 30'], cwd: process.cwd() },
        managedBashContext(context),
      );

      if (!('pid' in handle)) throw new Error('The command did not start');

      const row = await registry.promote(handle, {
        ownerUserId: 'owner',
        chatId: 'chat',
        runId: 'run',
        toolCallId: 'call',
        startedAt: new Date(),
        settings: { modelId: 'm', permissionMode: 'default' },
        maxBytes: 1_000_000,
        configuredCredentials: [],
        artifactReadable: false,
        hostFiles: false,
      });

      const stored = rows.get(row.id);

      if (stored === undefined) throw new Error('The job was not promoted');
      stored.stopRequestedBy = 'owner';

      if (route === 'notification')
        deliverNotification = async (raw) => {
          const message = parseRunControl(raw);

          if (message?.kind === 'job-stop')
            await registry.recheckJob(message.jobId);
        };

      await expect(
        stopTool.execute(
          { ...context, bashJobs: route === 'local' ? registry : undefined },
          { jobs: ['job://bash-1'] },
        ),
      ).resolves.toMatchObject({
        jobs: [{ state: 'cancelled', stopped_by: 'owner' }],
      });
      await expect(handle.settled).resolves.toMatchObject({
        type: 'cancelled',
      });
    },
    10_000,
  );
});
