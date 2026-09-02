import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { Queue } from '../queue/queue';
import type { Db } from '../db/tenant-db.service';
import { SessionsRepository } from './sessions.repository';
import {
  SessionCleanupService,
  SESSIONS_CLEANUP_QUEUE,
} from './session-cleanup.service';

describe('SessionCleanupService', () => {
  let originalProfile: string | undefined;

  beforeEach(() => {
    originalProfile = process.env.LLAME_WORKER_PROFILE;
  });

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.LLAME_WORKER_PROFILE;
    else process.env.LLAME_WORKER_PROFILE = originalProfile;
  });

  function makeService(concurrency: number | null) {
    let cleanup: (() => Promise<void>) | undefined;
    const queue: Queue = {
      ensureQueue: () => Promise.resolve(),
      enqueue: () => Promise.resolve(null),
      consume: (_queue, handler) => {
        // SAFETY: the cleanup callback ignores both queue payload and metadata;
        // the wrapper supplies the unused values only to invoke it in tests.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        cleanup = () => handler(undefined as never, undefined as never);
        return Promise.resolve('consumer');
      },
      schedule: () => Promise.resolve(),
      unschedule: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    };
    const ensureQueue = vi.spyOn(queue, 'ensureQueue');
    const consume = vi.spyOn(queue, 'consume');
    const schedule = vi.spyOn(queue, 'schedule');
    const db: Db = drizzle.mock({ schema });
    const sessionsRepository = new SessionsRepository(db);
    const deleteExpired = vi
      .spyOn(sessionsRepository, 'deleteExpired')
      .mockResolvedValue(0);
    const profileName = concurrency === null ? 'web' : 'all';
    const configuredConcurrency = concurrency ?? 1;
    process.env.LLAME_WORKER_PROFILE = profileName;
    const workerProfile = new WorkerProfileService({
      config: {
        ...BUILT_IN_DEFAULTS,
        workers: {
          ...BUILT_IN_DEFAULTS.workers,
          [profileName]:
            profileName === 'web'
              ? {}
              : {
                  ...BUILT_IN_DEFAULTS.workers.all,
                  'sessions-cleanup': configuredConcurrency,
                },
        },
      },
    });
    const concurrencyFor = vi.spyOn(workerProfile, 'concurrencyFor');
    return {
      service: new SessionCleanupService(
        queue,
        sessionsRepository,
        workerProfile,
      ),
      queue,
      ensureQueue,
      consume,
      schedule,
      sessionsRepository,
      workerProfile,
      concurrencyFor,
      deleteExpired,
      cleanup: () => {
        if (cleanup === undefined)
          throw new Error('cleanup was not registered');
        return cleanup();
      },
    };
  }

  it('does not register a queue consumer outside the cleanup worker profile', async () => {
    const { service, ensureQueue, schedule, consume, concurrencyFor } =
      makeService(null);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(concurrencyFor).toHaveBeenCalledWith('sessions-cleanup');
    expect(ensureQueue).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('ensures and schedules the cleanup queue with the configured concurrency', async () => {
    const { service, ensureQueue, schedule, consume, concurrencyFor } =
      makeService(3);

    await service.onApplicationBootstrap();

    expect(concurrencyFor).toHaveBeenCalledWith('sessions-cleanup');
    expect(ensureQueue).toHaveBeenCalledWith(SESSIONS_CLEANUP_QUEUE);
    expect(schedule).toHaveBeenCalledWith(SESSIONS_CLEANUP_QUEUE, '23 * * * *');
    expect(consume).toHaveBeenCalledWith(
      SESSIONS_CLEANUP_QUEUE,
      expect.any(Function),
      { concurrency: 3 },
    );
  });

  it('runs the sweep for empty and non-empty tables and rethrows failures', async () => {
    const first = makeService(1);
    await first.service.onApplicationBootstrap();
    await first.cleanup();
    expect(first.deleteExpired).toHaveBeenCalledOnce();

    first.deleteExpired.mockResolvedValue(2);
    await first.cleanup();
    expect(first.deleteExpired).toHaveBeenCalledTimes(2);

    const failure = new Error('database offline');
    first.deleteExpired.mockRejectedValue(failure);
    await expect(first.cleanup()).rejects.toBe(failure);
  });
});
