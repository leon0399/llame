import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

function make(concurrency: number | null, heartbeatSeconds = 15) {
  const statements: Array<{ sql: string; params: Array<unknown> }> = [];

  const db: Db = drizzle.mock({
    schema,
    logger: {
      logQuery: (sql, params) => void statements.push({ sql, params }),
    },
  });

  const service = new WorkerHeartbeatService(
    db,
    {
      config: {
        ...BUILT_IN_DEFAULTS,
        runs: { ...BUILT_IN_DEFAULTS.runs, heartbeatSeconds },
      },
    },
    { concurrencyFor: () => concurrency },
  );

  return { service, statements };
}

describe('WorkerHeartbeatService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes a new identity for each process', () => {
    expect(make(1).service.instanceId).not.toBe(make(1).service.instanceId);
  });

  it('upserts its row with the database clock', async () => {
    const { service, statements } = make(1);

    await service.beat().catch(() => undefined);

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('insert into "worker_instances"');
    expect(statements[0].sql).toContain('on conflict ("id") do update');
    expect(statements[0].sql).toContain('now()');
    expect(statements[0].params).toContain(service.instanceId);
  });

  it('records no heartbeat in a process without the runs group', async () => {
    const { service, statements } = make(null);

    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(statements).toEqual([]);
    service.onModuleDestroy();
  });

  it('beats at start and then once for each interval, until destroyed', async () => {
    const { service } = make(1, 10);
    const beat = vi.spyOn(service, 'beat').mockResolvedValue(undefined);

    await service.onModuleInit();
    expect(beat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9999);
    expect(beat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(beat).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(beat).toHaveBeenCalledTimes(3);

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it('keeps beating after a failed beat and logs it', async () => {
    const { service } = make(1, 10);
    const beat = vi.spyOn(service, 'beat');

    const warn = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => {});

    beat
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('down'));
    beat.mockResolvedValue(undefined);

    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(warn).toHaveBeenCalledWith('Worker heartbeat failed: Error: down');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(beat).toHaveBeenCalledTimes(3);
    service.onModuleDestroy();
  });
});
