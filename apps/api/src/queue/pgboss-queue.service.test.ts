/**
 * Regression guard for a SILENT dependency-injection failure (#196).
 *
 * The `search:*` operator commands boot this DI graph through
 * `npx tsx src/search/operations/cli.ts`. tsx compiles with esbuild, which
 * does NOT implement `emitDecoratorMetadata` — so `design:paramtypes` is
 * absent at runtime no matter what `tsconfig.json` says.
 *
 * A constructor that relies on type-based injection therefore receives
 * `undefined` for that parameter, and Nest raises NO resolution error: the
 * provider constructs "successfully" and dies later on first use. The
 * observed symptom was `Cannot read properties of undefined (reading 'boss')`
 * repeated once per chat, with `backfill` reporting 458 failures and zero
 * enqueues.
 *
 * `@Inject(TOKEN)` records `self:paramtypes`, which esbuild preserves because
 * it is written by the decorator itself rather than synthesised from types.
 * Asserting on that metadata — not on behavior — is what makes this test
 * independent of the runtime it happens to execute under: it fails if anyone
 * drops the explicit token, even when running under a toolchain whose
 * metadata emission would have masked the bug.
 */

import 'reflect-metadata';

import { PgBossService } from '@wavezync/nestjs-pgboss';

import { isRecord } from '../unknown-record';
import {
  DEFAULT_QUEUE_OPTIONS,
  PgBossQueueService,
} from './pgboss-queue.service';
import { defineQueue } from './queue';

function makeQueueService() {
  const createQueue = vi.fn().mockResolvedValue(undefined);
  const updateQueue = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue('job-1');
  const work = vi.fn().mockResolvedValue('consumer-1');
  const schedule = vi.fn().mockResolvedValue(undefined);
  const unschedule = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const boss = {
    createQueue,
    updateQueue,
    send,
    work,
    schedule,
    unschedule,
    cancel,
  };
  const pgBoss = { boss };
  // SAFETY: PgBossQueueService only reads `boss` from this double, and every
  // method it calls is represented by a resolving spy above.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- the test double implements the service's one consumed property
  const service = new PgBossQueueService(pgBoss as never);
  return {
    service,
    createQueue,
    updateQueue,
    send,
    work,
    schedule,
    unschedule,
    cancel,
  };
}

/** What `@Inject(TOKEN)` accepts: a class, a string, or a symbol. */
type InjectionToken =
  | string
  | symbol
  | (abstract new (...args: Array<never>) => object);

/** What `@Inject()` writes: one entry per decorated constructor parameter. */
type SelfParamType = { index: number; param: InjectionToken };

function isInjectionToken(value: unknown): value is InjectionToken {
  return (
    typeof value === 'function' ||
    typeof value === 'string' ||
    typeof value === 'symbol'
  );
}

function isSelfParamType(value: unknown): value is SelfParamType {
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    isInjectionToken(value.param)
  );
}

/** A Nest provider class, i.e. what `@Injectable()` decorates. */
type ProviderClass = abstract new (...args: Array<never>) => object;

/**
 * Narrows `Reflect.getMetadata`'s `unknown` without asserting: an absent or
 * malformed entry must read as "not decorated" and fail the expectation,
 * never throw or be silently coerced into a passing shape.
 */
function selfParamTypesOf(target: ProviderClass): Array<SelfParamType> {
  const metadata: unknown = Reflect.getMetadata('self:paramtypes', target);
  if (!Array.isArray(metadata)) return [];
  return metadata.filter(isSelfParamType);
}

describe('PgBossQueueService dependency injection', () => {
  it('injects PgBossService by explicit token, not by type metadata', () => {
    const injected = selfParamTypesOf(PgBossQueueService);

    expect(injected.length).toBeGreaterThan(0);
    expect(injected.some((p) => p.param === PgBossService)).toBe(true);
  });

  it('does not depend on design:paramtypes, which esbuild never emits', () => {
    // Every constructor parameter must be covered by an explicit token, so the
    // provider resolves identically with or without emitted type metadata.
    const decorated = new Set(
      selfParamTypesOf(PgBossQueueService).map((p) => p.index),
    );

    for (let index = 0; index < PgBossQueueService.length; index++) {
      expect(decorated.has(index)).toBe(true);
    }
  });
});

describe('PgBossQueueService queue operations', () => {
  it('creates dead-letter and main queues with the declared policy', async () => {
    const { service, createQueue, updateQueue } = makeQueueService();
    const queue = defineQueue<{ value: string }>({
      name: 'work',
      options: {
        retryLimit: 5,
        retryDelay: 10,
        retryBackoff: false,
        deadLetter: true,
        policy: 'stately',
        heartbeatSeconds: 20,
      },
    });

    await service.ensureQueue(queue);

    expect(createQueue).toHaveBeenNthCalledWith(1, 'work.dead', {
      retryLimit: 0,
    });
    expect(updateQueue).toHaveBeenNthCalledWith(1, 'work.dead', {
      retryLimit: 0,
    });
    expect(createQueue).toHaveBeenNthCalledWith(
      2,
      'work',
      expect.objectContaining({
        retryLimit: 5,
        retryDelay: 10,
        retryBackoff: false,
        deadLetter: 'work.dead',
        heartbeatSeconds: 20,
        policy: 'stately',
      }),
    );
    expect(updateQueue).toHaveBeenNthCalledWith(
      2,
      'work',
      expect.objectContaining({
        retryLimit: 5,
        retryDelay: 10,
        retryBackoff: false,
        deadLetter: 'work.dead',
        heartbeatSeconds: 20,
      }),
    );
    expect(updateQueue.mock.calls[1]?.[1]).not.toHaveProperty('policy');
  });

  it('applies defaults without provisioning a dead-letter queue when disabled', async () => {
    const { service, createQueue, updateQueue } = makeQueueService();
    const queue = defineQueue<{ value: string }>({
      name: 'plain',
      options: { deadLetter: false },
    });

    await service.ensureQueue(queue);

    expect(createQueue).toHaveBeenCalledOnce();
    expect(createQueue).toHaveBeenCalledWith(
      'plain',
      expect.objectContaining({
        retryLimit: DEFAULT_QUEUE_OPTIONS.retryLimit,
        retryDelay: DEFAULT_QUEUE_OPTIONS.retryDelay,
        retryBackoff: DEFAULT_QUEUE_OPTIONS.retryBackoff,
        policy: DEFAULT_QUEUE_OPTIONS.policy,
      }),
    );
    expect(updateQueue).toHaveBeenCalledOnce();
    expect(updateQueue.mock.calls[0]?.[1]).not.toHaveProperty('deadLetter');
    expect(updateQueue.mock.calls[0]?.[1]).not.toHaveProperty(
      'heartbeatSeconds',
    );
  });

  it('forwards every enqueue option and sends an empty options object by default', async () => {
    const { service, send } = makeQueueService();
    const queue = defineQueue<{ value: string }>({ name: 'work' });
    const startAfter = new Date('2026-09-02T00:00:00.000Z');

    await expect(
      service.enqueue(
        queue,
        { value: 'first' },
        {
          priority: 4,
          startAfter,
          retryLimit: 2,
          retryDelay: 3,
          retryBackoff: false,
          singletonKey: 'same-work',
        },
      ),
    ).resolves.toBe('job-1');
    await expect(service.enqueue(queue, { value: 'second' })).resolves.toBe(
      'job-1',
    );

    expect(send).toHaveBeenNthCalledWith(
      1,
      'work',
      { value: 'first' },
      {
        priority: 4,
        startAfter,
        retryLimit: 2,
        retryDelay: 3,
        retryBackoff: false,
        singletonKey: 'same-work',
      },
    );
    expect(send).toHaveBeenNthCalledWith(2, 'work', { value: 'second' }, {});
  });

  it('consumes parsed jobs with metadata and defaults to one local worker', async () => {
    const { service, work } = makeQueueService();
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- this parser intentionally models the queue's unknown cross-process payload boundary
    const parse = vi.fn((data: unknown) => {
      if (
        !isRecord(data) ||
        // eslint-disable-next-line anti-slop/no-runtime-typeof -- the parser must establish the string field before returning its domain value
        typeof data.value !== 'string' ||
        data.value.length === 0
      ) {
        throw new TypeError('invalid test payload');
      }
      return { value: data.value };
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = defineQueue<{ value: string }>({
      name: 'parsed',
      parse,
    });

    await expect(
      service.consume(queue, handler, {
        concurrency: 3,
        pollingIntervalSeconds: 7,
      }),
    ).resolves.toBe('consumer-1');

    expect(work).toHaveBeenNthCalledWith(
      1,
      'parsed',
      {
        batchSize: 1,
        localConcurrency: 3,
        pollingIntervalSeconds: 7,
      },
      expect.any(Function),
    );
    // eslint-disable-next-line typescript/no-unsafe-assignment -- Vitest's untyped mock call tuple is narrowed by the guard below
    const firstCallback = work.mock.calls[0]?.[2];
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrow the mocked callback before invoking it
    if (typeof firstCallback !== 'function') {
      throw new Error('expected pg-boss work callback');
    }
    // eslint-disable-next-line typescript/no-unsafe-call -- the preceding guard narrows the mocked callback
    await firstCallback([
      { id: 'job-1', data: { value: 'first' } },
      { id: 'job-2', data: { value: 'second' } },
    ]);
    expect(parse).toHaveBeenNthCalledWith(1, { value: 'first' });
    expect(parse).toHaveBeenNthCalledWith(2, { value: 'second' });
    expect(handler).toHaveBeenNthCalledWith(
      1,
      { value: 'first' },
      {
        id: 'job-1',
        queue: 'parsed',
      },
    );
    expect(handler).toHaveBeenNthCalledWith(
      2,
      { value: 'second' },
      {
        id: 'job-2',
        queue: 'parsed',
      },
    );

    const plainHandler = vi.fn().mockResolvedValue(undefined);
    const plainQueue = defineQueue<{ value: string }>({ name: 'plain' });
    await service.consume(plainQueue, plainHandler);
    expect(work).toHaveBeenNthCalledWith(
      2,
      'plain',
      { batchSize: 1, localConcurrency: 1 },
      expect.any(Function),
    );
    // eslint-disable-next-line typescript/no-unsafe-assignment -- Vitest's untyped mock call tuple is narrowed by the guard below
    const secondCallback = work.mock.calls[1]?.[2];
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrow the mocked callback before invoking it
    if (typeof secondCallback !== 'function') {
      throw new Error('expected pg-boss work callback');
    }
    // eslint-disable-next-line typescript/no-unsafe-call -- the preceding guard narrows the mocked callback
    await secondCallback([{ id: 'job-3', data: { value: 'plain' } }]);
    expect(plainHandler).toHaveBeenCalledWith(
      { value: 'plain' },
      { id: 'job-3', queue: 'plain' },
    );
  });

  it('delegates schedule, unschedule, and cancel to pg-boss', async () => {
    const { service, schedule, unschedule, cancel } = makeQueueService();
    const queue = defineQueue<{ value: string }>({ name: 'scheduled' });

    await service.schedule(queue, '*/5 * * * *', { value: 'scheduled' });
    await service.unschedule(queue);
    await service.cancel(queue, 'job-1');

    expect(schedule).toHaveBeenCalledWith('scheduled', '*/5 * * * *', {
      value: 'scheduled',
    });
    expect(unschedule).toHaveBeenCalledWith('scheduled');
    expect(cancel).toHaveBeenCalledWith('scheduled', 'job-1');
  });
});
