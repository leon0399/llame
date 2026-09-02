/**
 * SearchReindexWorker's boot-time provisioning self-check (#195, D6; extended
 * for chat-search-embeddings, design D10/task 6.5) — pure unit test, no
 * database. `assertDiscoveryProvisioned` reads only `pg_proc`/`pg_roles`
 * catalog metadata via `tenantDb.runAsPublic`, so its contract (log loudly,
 * never throw, gate on `rolbypassrls`) is exercised here by stubbing that
 * call rather than standing up a live Postgres — simulating a mis-provisioned
 * function (owned by a non-BYPASSRLS role, or absent entirely, e.g. before
 * migrations run) would otherwise require reassigning the function's owner,
 * which the RLS integration harness cannot do connected as the
 * non-superuser `app` role (see apps/api/CLAUDE.md's `app_rls` section) —
 * this is the lighter, DB-free alternative the task called for.
 *
 * `assertDiscoveryProvisioned` now checks THREE functions in sequence
 * (`llame_search_projection_stale_chats_v2`, `llame_search_embedding_coverage`, then
 * `llame_search_embedding_backlog`), each via its own `runAsPublic` call — so
 * the mock below drives an ORDERED SEQUENCE of responses, one per call,
 * repeating the last entry once exhausted. Most tests pass a single-entry
 * sequence (applied to all three calls); the "independently" test below
 * passes three different entries to prove the checks do not share state.
 *
 * The worker runs through Nest's public bootstrap lifecycle in a TestingModule.
 * Queue setup resolves without invoking the registered consumer callbacks, so
 * the test covers boot behavior without starting an indefinite consumer.
 */

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE } from '../queue/queue';
import {
  SEARCH_REINDEX_QUEUE,
  SEARCH_SWEEP_CRON,
  SEARCH_SWEEP_QUEUE,
  type SearchReindexJob,
} from './reindex-queues';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';
import { SearchIndexService } from './search-index.service';

type ProvisioningRow = {
  bypass?: boolean;
  chat_id?: string;
  owner_user_id?: string;
};
type ProvisioningTx = { execute: () => Promise<Array<ProvisioningRow>> };
type PublicRunner = <T>(fn: (tx: ProvisioningTx) => Promise<T>) => Promise<T>;
type CapturedQueue = typeof SEARCH_REINDEX_QUEUE | typeof SEARCH_SWEEP_QUEUE;
type ConsumerOptions = {
  pollingIntervalSeconds?: number;
  concurrency?: number;
};
type CapturedHandler = (job?: SearchReindexJob) => Promise<void>;
type BacklogRow = { chat_id: string; owner_user_id: string };
type BacklogResult =
  | ReadonlyArray<BacklogRow>
  | ReadonlyArray<Record<string, never>>
  | void;
type BacklogTx = {
  select: () => {
    from: () => { where: () => Promise<ReadonlyArray<Record<string, never>>> };
  };
  execute: () => Promise<ReadonlyArray<BacklogRow>>;
};

const openModules: Array<TestingModule> = [];

/**
 * Returns a PublicRunner that yields the next row-set in `sequence` for each
 * successive call, repeating the last entry once the sequence is exhausted.
 */
function provisioned(sequence: Array<Array<ProvisioningRow>>): PublicRunner {
  let call = 0;
  return <T>(fn: (tx: ProvisioningTx) => Promise<T>) => {
    const rows = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return fn({ execute: () => Promise.resolve(rows) });
  };
}

async function buildWorker(
  runAsPublic: PublicRunner,
  overrides: {
    indexService?: {
      reindexChat: (chatId: string, ownerUserId: string) => Promise<void>;
    };
    dispatch?: {
      enqueueChatReindex: (
        chatId: string,
        ownerUserId: string,
      ) => Promise<void>;
    };
    embedDispatch?: {
      enqueueChatEmbed: (chatId: string, ownerUserId: string) => Promise<void>;
    };
  } = {},
) {
  const errorSpy = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const warnSpy = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  const ensureQueue = vi.fn().mockResolvedValue(undefined);
  const consume = vi.fn(
    (
      _queue: CapturedQueue,
      _handler: CapturedHandler,
      _options?: ConsumerOptions,
    ) => Promise.resolve('consumer-id'),
  );
  const schedule = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue('job-id');
  const indexService =
    overrides.indexService ??
    ({ reindexChat: vi.fn().mockResolvedValue(undefined) } satisfies {
      reindexChat: (chatId: string, ownerUserId: string) => Promise<void>;
    });
  const dispatch =
    overrides.dispatch ??
    ({
      enqueueChatReindex: vi.fn().mockResolvedValue(undefined),
    } satisfies {
      enqueueChatReindex: (
        chatId: string,
        ownerUserId: string,
      ) => Promise<void>;
    });
  const embedDispatch =
    overrides.embedDispatch ??
    ({
      enqueueChatEmbed: vi.fn().mockResolvedValue(undefined),
    } satisfies {
      enqueueChatEmbed: (chatId: string, ownerUserId: string) => Promise<void>;
    });
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchReindexWorker,
      {
        provide: QUEUE,
        useValue: {
          ensureQueue,
          consume,
          schedule,
          enqueue,
        },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
      { provide: SearchIndexService, useValue: indexService },
      { provide: SearchReindexDispatchService, useValue: dispatch },
      { provide: SearchEmbedDispatchService, useValue: embedDispatch },
      {
        provide: WorkerProfileService,
        useValue: { concurrencyFor: () => 1 },
      },
      {
        provide: InstanceConfigService,
        useValue: { config: BUILT_IN_DEFAULTS },
      },
    ],
  }).compile();
  openModules.push(moduleRef);
  const worker = moduleRef.get(SearchReindexWorker);
  const check = () => worker.onApplicationBootstrap();
  return {
    check,
    consume,
    dispatch,
    embedDispatch,
    enqueue,
    ensureQueue,
    errorSpy,
    indexService,
    schedule,
    warnSpy,
    worker,
  };
}

async function buildBacklogWorker(options: {
  binding: boolean;
  backlog: ReadonlyArray<BacklogRow>;
}) {
  const selectWhere = vi.fn().mockResolvedValue(options.binding ? [{}] : []);
  const selectQuery = {
    from: vi.fn(() => ({ where: selectWhere })),
  };
  const tx: BacklogTx = {
    select: vi.fn(() => selectQuery),
    execute: vi.fn(() => Promise.resolve(options.backlog)),
  };
  const runAsPublic = vi.fn(
    (callback: (transaction: BacklogTx) => Promise<BacklogResult>) =>
      callback(tx),
  );
  const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
  const config = structuredClone(BUILT_IN_DEFAULTS);
  config.search.chats.embeddingModelId = 'embed-a';
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchReindexWorker,
      { provide: QUEUE, useValue: {} },
      { provide: TenantDbService, useValue: { runAsPublic } },
      { provide: SearchIndexService, useValue: {} },
      { provide: SearchReindexDispatchService, useValue: {} },
      { provide: SearchEmbedDispatchService, useValue: { enqueueChatEmbed } },
      {
        provide: WorkerProfileService,
        useValue: { concurrencyFor: () => 1 },
      },
      { provide: InstanceConfigService, useValue: { config } },
    ],
  }).compile();
  openModules.push(moduleRef);
  return { enqueueChatEmbed, moduleRef, runAsPublic, selectWhere, tx };
}

describe('SearchReindexWorker.assertDiscoveryProvisioned', () => {
  afterEach(async () => {
    await Promise.all(
      openModules.splice(0).map((moduleRef) => moduleRef.close()),
    );
    vi.restoreAllMocks();
  });

  it('is silent when all three functions are owned by a BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(
      provisioned([[{ bypass: true }]]),
    );
    await check();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error per function (and does not throw) when all three are owned by a non-BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(
      provisioned([[{ bypass: false }]]),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy.mock.calls[0][0]).toContain('BYPASSRLS');
    expect(errorSpy.mock.calls[1][0]).toContain('BYPASSRLS');
    expect(errorSpy.mock.calls[2][0]).toContain('BYPASSRLS');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error per function (and does not throw) when all three are absent', async () => {
    // No row at all — e.g. the migration creating the functions hasn't run yet.
    const { check, errorSpy } = await buildWorker(provisioned([[]]));
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('checks the embedding coverage function independently of the lexical staleness function', async () => {
    // Stale-chats check passes (bypass: true), embedding-coverage check fails
    // (bypass: false), embedding-backlog check passes again — proves each
    // check does not share a single verdict.
    const { check, errorSpy } = await buildWorker(
      provisioned([
        [{ bypass: true }],
        [{ bypass: false }],
        [{ bypass: true }],
      ]),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(
      'llame_search_embedding_coverage',
    );
    expect(errorSpy.mock.calls[0][0]).toContain('BYPASSRLS');
  });

  it('checks the embedding backlog function independently of the other two (chat-search-embeddings task 6.5)', async () => {
    // Stale-chats + embedding-coverage checks pass, embedding-backlog check
    // fails — proves the backlog check is not just re-reading the coverage
    // check's verdict.
    const { check, errorSpy } = await buildWorker(
      provisioned([
        [{ bypass: true }],
        [{ bypass: true }],
        [{ bypass: false }],
      ]),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(
      'llame_search_embedding_backlog',
    );
    expect(errorSpy.mock.calls[0][0]).toContain('BYPASSRLS');
  });

  it('degrades to a warning per function (never throws) when the check itself fails to run', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(() =>
      Promise.reject(new Error('connection refused')),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls[0][0]).toContain('connection refused');
    expect(warnSpy.mock.calls[1][0]).toContain('connection refused');
    expect(warnSpy.mock.calls[2][0]).toContain('connection refused');
  });

  it('registers both consumers, the cron schedule, and the immediate sweep enqueue', async () => {
    const harness = await buildWorker(provisioned([[{ bypass: true }]]));

    await harness.check();

    expect(harness.ensureQueue).toHaveBeenNthCalledWith(
      1,
      SEARCH_REINDEX_QUEUE,
    );
    expect(harness.ensureQueue).toHaveBeenNthCalledWith(2, SEARCH_SWEEP_QUEUE);
    expect(harness.consume).toHaveBeenCalledTimes(2);
    expect(harness.consume.mock.calls[0]?.[0]).toBe(SEARCH_REINDEX_QUEUE);
    expect(harness.consume.mock.calls[0]?.[2]).toEqual({
      pollingIntervalSeconds: 1,
      concurrency: 1,
    });
    expect(harness.consume.mock.calls[1]?.[0]).toBe(SEARCH_SWEEP_QUEUE);
    expect(harness.schedule).toHaveBeenCalledWith(
      SEARCH_SWEEP_QUEUE,
      SEARCH_SWEEP_CRON,
      {},
    );
    expect(harness.enqueue).toHaveBeenCalledWith(SEARCH_SWEEP_QUEUE, {});
  });

  it('reindexes a consumed job and then enqueues its embed follow-up', async () => {
    const reindexChat = vi.fn().mockResolvedValue(undefined);
    const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
    const harness = await buildWorker(provisioned([[{ bypass: true }]]), {
      indexService: { reindexChat },
      embedDispatch: { enqueueChatEmbed },
    });
    await harness.check();
    const handler = harness.consume.mock.calls[0]?.[1];
    if (handler === undefined)
      throw new Error('reindex handler was not registered');

    await handler({ chatId: 'chat-1', ownerUserId: 'owner-1' });

    expect(reindexChat).toHaveBeenCalledWith('chat-1', 'owner-1');
    expect(enqueueChatEmbed).toHaveBeenCalledWith('chat-1', 'owner-1');
  });

  it('logs and rethrows a failed reindex job', async () => {
    const failure = new Error('reindex failed');
    const reindexChat = vi.fn().mockRejectedValue(failure);
    const harness = await buildWorker(provisioned([[{ bypass: true }]]), {
      indexService: { reindexChat },
    });
    await harness.check();
    const handler = harness.consume.mock.calls[0]?.[1];
    if (handler === undefined)
      throw new Error('reindex handler was not registered');

    await expect(
      handler({ chatId: 'chat-1', ownerUserId: 'owner-1' }),
    ).rejects.toBe(failure);
    expect(harness.errorSpy).toHaveBeenCalledWith(
      'Reindex failed for chat chat-1',
      expect.any(String),
    );
  });

  it('runs the lexical sweep in bounded batches and logs its discoveries', async () => {
    const staleRows = Array.from({ length: 21 }, (_, index) => ({
      chat_id: `chat-${index}`,
      owner_user_id: `owner-${index}`,
    }));
    let call = 0;
    const runAsPublic: PublicRunner = (fn) => {
      const rows = call++ < 3 ? [{ bypass: true }] : staleRows;
      return fn({ execute: () => Promise.resolve(rows) });
    };
    const enqueueChatReindex = vi.fn().mockResolvedValue(undefined);
    const harness = await buildWorker(runAsPublic, {
      dispatch: { enqueueChatReindex },
    });
    await harness.check();
    const sweepHandler = harness.consume.mock.calls[1]?.[1];
    if (sweepHandler === undefined)
      throw new Error('sweep handler was not registered');

    await sweepHandler();

    expect(enqueueChatReindex).toHaveBeenCalledTimes(staleRows.length);
    expect(harness.worker).toBeDefined();
  });

  it('logs and rethrows a failed sweep', async () => {
    const failure = new Error('sweep failed');
    const enqueueChatReindex = vi.fn().mockRejectedValue(failure);
    const runAsPublic: PublicRunner = (fn) => {
      let call = 0;
      const rows =
        call++ < 3
          ? [{ bypass: true }]
          : [{ chat_id: 'c', owner_user_id: 'u' }];
      return fn({ execute: () => Promise.resolve(rows) });
    };
    const harness = await buildWorker(runAsPublic, {
      dispatch: { enqueueChatReindex },
    });
    await harness.check();
    const sweepHandler = harness.consume.mock.calls[1]?.[1];
    if (sweepHandler === undefined)
      throw new Error('sweep handler was not registered');

    await expect(sweepHandler()).rejects.toBe(failure);
    expect(harness.errorSpy).toHaveBeenCalledWith(
      'Search staleness sweep failed',
      expect.any(String),
    );
  });

  it('skips embed backlog discovery when no corpus model is configured', async () => {
    const runner = provisioned([[{ bypass: true }]]);
    let calls = 0;
    const runAsPublic: PublicRunner = (fn) => {
      calls += 1;
      return runner(fn);
    };
    const harness = await buildWorker(runAsPublic);

    await harness.worker.runEmbedBacklogSweep();

    expect(calls).toBe(0);
  });

  it('does not enqueue embed backlog work before a binding exists', async () => {
    const harness = await buildBacklogWorker({ binding: false, backlog: [] });

    await harness.moduleRef.get(SearchReindexWorker).runEmbedBacklogSweep();

    expect(harness.runAsPublic).toHaveBeenCalledTimes(1);
    expect(harness.selectWhere).toHaveBeenCalledTimes(1);
    expect(harness.tx.execute).not.toHaveBeenCalled();
    expect(harness.enqueueChatEmbed).not.toHaveBeenCalled();
  });

  it('enqueues every discovered embed backlog row once a binding exists', async () => {
    const backlog = Array.from({ length: 21 }, (_, index) => ({
      chat_id: `chat-${index}`,
      owner_user_id: `owner-${index}`,
    }));
    const harness = await buildBacklogWorker({ binding: true, backlog });
    const logSpy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    await harness.moduleRef.get(SearchReindexWorker).runEmbedBacklogSweep();

    expect(harness.runAsPublic).toHaveBeenCalledTimes(2);
    expect(harness.tx.execute).toHaveBeenCalledTimes(1);
    expect(harness.enqueueChatEmbed).toHaveBeenCalledTimes(backlog.length);
    expect(logSpy).toHaveBeenCalledWith(
      `Sweep enqueued ${backlog.length} chat embed job(s)`,
    );
  });
});
