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
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';
import { SearchIndexService } from './search-index.service';

type ProvisioningRow = { bypass: boolean };
type ProvisioningTx = { execute: () => Promise<Array<ProvisioningRow>> };
type PublicRunner = <T>(fn: (tx: ProvisioningTx) => Promise<T>) => Promise<T>;

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

async function buildWorker(runAsPublic: PublicRunner) {
  const errorSpy = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const warnSpy = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchReindexWorker,
      {
        provide: QUEUE,
        useValue: {
          ensureQueue: vi.fn().mockResolvedValue(undefined),
          consume: vi.fn().mockResolvedValue(undefined),
          schedule: vi.fn().mockResolvedValue(undefined),
          enqueue: vi.fn().mockResolvedValue(undefined),
        },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
      { provide: SearchIndexService, useValue: {} },
      { provide: SearchReindexDispatchService, useValue: {} },
      { provide: SearchEmbedDispatchService, useValue: {} },
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
  return { check, errorSpy, warnSpy };
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
});
