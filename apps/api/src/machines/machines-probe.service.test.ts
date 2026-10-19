/**
 * MachinesProbeService — the boot gate and one probe tick, asserted on the
 * calls the service actually makes rather than on the fact that something ran:
 *
 * - an instance without a `machines` section registers nothing at all, and
 *   neither does a profile that consumes no `runs`;
 * - otherwise the queue is declared, scheduled on the minute, and consumed at
 *   the profile's `runs` concurrency;
 * - one tick asks the connector about EVERY configured Machine under a single
 *   attempt key, then prunes the rows of Machines the operator removed;
 * - the prune is logged only when it removed something.
 */

import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { MachinesConfig } from '../instance-config/machines-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import type { Queue } from '../queue/queue';

import { MachineConnector } from './machine-connector.service';
import { MachinesProbeService } from './machines-probe.service';
import {
  MACHINES_PROBE_CRON,
  MACHINES_PROBE_QUEUE,
  type MachinesProbeJob,
} from './machines-queues';
import { MachinesStatusRepository } from './machines-status.repository';

const MACHINES: MachinesConfig = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' }, ci: { destination: 'ci-box' } },
};

const NOW = new Date('2026-10-19T10:00:00.000Z');
const PROFILE_ENV = 'LLAME_WORKER_PROFILE';

/**
 * The concrete instantiation of `Queue['consume']` for the probe queue.
 * `vi.fn()`'s own generic cannot express `consume`'s `<Q extends
 * QueueDefinition<any>>` signature directly, so — like the runs worker suite —
 * the mock is typed at this fixed instantiation instead of the generic method.
 */
type ConsumeMockFn = (
  queue: typeof MACHINES_PROBE_QUEUE,
  handler: (
    data: MachinesProbeJob,
    meta: { readonly id: string; readonly queue: string },
  ) => Promise<void>,
) => Promise<string>;

describe('MachinesProbeService', () => {
  let originalProfile: string | undefined;

  beforeEach(() => {
    originalProfile = process.env[PROFILE_ENV];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalProfile === undefined) delete process.env[PROFILE_ENV];
    else process.env[PROFILE_ENV] = originalProfile;
  });

  function makeService(options: {
    readonly enabled: boolean;
    readonly concurrency: number | null;
    readonly pruned: number;
  }) {
    let registered:
      | {
          readonly handler: (
            data: MachinesProbeJob,
            meta: { readonly id: string; readonly queue: string },
          ) => Promise<void>;
        }
      | undefined;
    // A mocked generic method infers a concrete instantiation that cannot
    // structurally satisfy `consume`'s own `<Q>`. Typing the mock at the probe
    // queue's fixed instantiation lets its implementation capture the handler
    // with checked parameters — no cast, because `MachinesProbeJob` is exactly
    // the payload the cron tick parses to.
    const consumeProbe = vi
      .fn<ConsumeMockFn>()
      .mockImplementation((_definition, handler) => {
        registered = { handler };
        return Promise.resolve('probe-consumer');
      });
    const queue: Queue = {
      ensureQueue: () => Promise.resolve(),
      enqueue: () => Promise.resolve(null),
      consume: consumeProbe,
      schedule: () => Promise.resolve(),
      unschedule: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      jobState: () => Promise.resolve('absent'),
    };
    const ensureQueue = vi.spyOn(queue, 'ensureQueue');
    const consume = vi.spyOn(queue, 'consume');
    const schedule = vi.spyOn(queue, 'schedule');
    const connector = new MachineConnector({
      machines: options.enabled ? MACHINES : undefined,
      hubVersion: '9.9.9',
    });
    const reachable = vi.spyOn(connector, 'reachable').mockResolvedValue(true);
    const status = new MachinesStatusRepository(
      drizzle.mock({ schema }),
      new TenantDbService({
        transaction: async <T>(callback: (tx: Db) => Promise<T>) =>
          callback(drizzle.mock({ schema })),
      }),
    );
    const pruneExcept = vi
      .spyOn(status, 'pruneExcept')
      .mockResolvedValue(options.pruned);
    const profileName = options.concurrency === null ? 'web' : 'all';
    process.env[PROFILE_ENV] = profileName;
    // The profile service logs its own resolution at construction; only what
    // the probe itself logs is under test here.
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const workerProfile = new WorkerProfileService({
      config: {
        ...BUILT_IN_DEFAULTS,
        workers: {
          ...BUILT_IN_DEFAULTS.workers,
          [profileName]:
            options.concurrency === null
              ? {}
              : { ...BUILT_IN_DEFAULTS.workers.all, runs: options.concurrency },
        },
      },
    });
    log.mockClear();
    return {
      service: new MachinesProbeService(
        queue,
        connector,
        status,
        workerProfile,
      ),
      ensureQueue,
      schedule,
      consume,
      reachable,
      pruneExcept,
      log,
      probe: () => {
        if (registered === undefined)
          throw new Error('the probe consumer was never registered');
        // The probe carries no data and ignores its metadata: this is the
        // queue's own parsed payload, so the tick runs against real input.
        return registered.handler(MACHINES_PROBE_QUEUE.parse?.({}) ?? {}, {
          id: 'probe-tick',
          queue: MACHINES_PROBE_QUEUE.name,
        });
      },
    };
  }

  it('registers nothing when the instance configures no Machines', async () => {
    const fixture = makeService({ enabled: false, concurrency: 3, pruned: 0 });

    await expect(
      fixture.service.onApplicationBootstrap(),
    ).resolves.toBeUndefined();

    expect(fixture.ensureQueue).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(fixture.consume).not.toHaveBeenCalled();
  });

  it('registers nothing when this profile consumes no Runs', async () => {
    const fixture = makeService({
      enabled: true,
      concurrency: null,
      pruned: 0,
    });

    await expect(
      fixture.service.onApplicationBootstrap(),
    ).resolves.toBeUndefined();

    expect(fixture.ensureQueue).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(fixture.consume).not.toHaveBeenCalled();
  });

  it('declares, schedules, and consumes the probe queue at the runs concurrency', async () => {
    const fixture = makeService({ enabled: true, concurrency: 3, pruned: 0 });

    await fixture.service.onApplicationBootstrap();

    expect(fixture.ensureQueue).toHaveBeenCalledWith(MACHINES_PROBE_QUEUE);
    expect(fixture.schedule).toHaveBeenCalledWith(
      MACHINES_PROBE_QUEUE,
      MACHINES_PROBE_CRON,
    );
    expect(fixture.consume).toHaveBeenCalledWith(
      MACHINES_PROBE_QUEUE,
      expect.any(Function),
      { concurrency: 3 },
    );
  });

  it('asks about every configured Machine under one attempt key, then prunes', async () => {
    const fixture = makeService({ enabled: true, concurrency: 1, pruned: 0 });
    await fixture.service.onApplicationBootstrap();

    await fixture.probe();

    const attemptKey = `probe:${NOW.getTime()}`;
    expect(fixture.reachable.mock.calls).toEqual([
      ['devl', attemptKey],
      ['ci', attemptKey],
    ]);
    expect(fixture.pruneExcept).toHaveBeenCalledWith(['devl', 'ci']);
    expect(fixture.log).not.toHaveBeenCalled();
  });

  it('logs the rows it pruned', async () => {
    const fixture = makeService({ enabled: true, concurrency: 1, pruned: 2 });
    await fixture.service.onApplicationBootstrap();

    await fixture.probe();

    expect(fixture.log).toHaveBeenCalledWith(
      'Pruned 2 status row(s) of removed Machine(s)',
    );
  });
});
