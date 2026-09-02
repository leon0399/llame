import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { type Queue } from '../queue/queue';
import { TenantDbService } from '../db/tenant-db.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { RunDispatchService } from './run-dispatch.service';

const job: RunJob = {
  runId: 'run-1',
  chatId: 'chat-1',
  userId: 'user-1',
  modelId: 'model-1',
  userMessage: { id: 'message-1', seq: 1, parts: [] },
};

function config(): InstanceConfigService {
  return { config: BUILT_IN_DEFAULTS };
}

function tenantDb(failure = new Error('unused transaction')): TenantDbService {
  return new TenantDbService({
    transaction: <_T>() => Promise.reject(failure),
  });
}

function queue(): Queue {
  return {
    ensureQueue: () => Promise.resolve(),
    enqueue: () => Promise.resolve('job-1'),
    consume: () => Promise.resolve('consumer-1'),
    schedule: () => Promise.resolve(),
    unschedule: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
}

describe('RunDispatchService', () => {
  it('ensures the configured runs queue once and enqueues the committed job', async () => {
    const q = queue();
    const ensureQueue = vi.spyOn(q, 'ensureQueue');
    const enqueue = vi.spyOn(q, 'enqueue');
    const service = new RunDispatchService(q, config(), tenantDb());

    await service.dispatch(job);
    await service.dispatch({ ...job, runId: 'run-2' });

    expect(ensureQueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenNthCalledWith(1, RUNS_QUEUE, job);
    expect(enqueue).toHaveBeenNthCalledWith(2, RUNS_QUEUE, {
      ...job,
      runId: 'run-2',
    });
  });

  it('retries queue bootstrap after failure and rethrows enqueue failures', async () => {
    const bootstrapFailure = new Error('queue offline');
    const q = queue();
    const ensureQueue = vi.spyOn(q, 'ensureQueue');
    const enqueue = vi.spyOn(q, 'enqueue');
    ensureQueue
      .mockRejectedValueOnce(bootstrapFailure)
      .mockResolvedValue(undefined);
    const service = new RunDispatchService(
      q,
      config(),
      tenantDb(bootstrapFailure),
    );

    await expect(service.dispatch(job)).rejects.toBe(bootstrapFailure);
    await expect(
      service.dispatch({ ...job, runId: 'run-2' }),
    ).resolves.toBeUndefined();
    expect(ensureQueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('fails the run transactionally when enqueue fails', async () => {
    const enqueueFailure = new Error('queue send failed');
    const db = tenantDb(enqueueFailure);
    const q = queue();
    const enqueue = vi.spyOn(q, 'enqueue');
    const runAs = vi.spyOn(db, 'runAs');
    enqueue.mockRejectedValue(enqueueFailure);
    const service = new RunDispatchService(q, config(), db);

    await expect(service.dispatch(job)).rejects.toBe(enqueueFailure);
    expect(enqueue).toHaveBeenCalledWith(RUNS_QUEUE, job);
    expect(runAs).toHaveBeenCalledWith('user-1', expect.any(Function));
  });
});
