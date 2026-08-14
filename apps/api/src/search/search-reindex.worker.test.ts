/**
 * SearchReindexWorker's boot-time provisioning self-check (#195, D6) — pure
 * unit test, no database. `assertDiscoveryProvisioned` reads only
 * `pg_proc`/`pg_roles` catalog metadata via `tenantDb.runAsPublic`, so its
 * contract (log loudly, never throw, gate on `rolbypassrls`) is exercised
 * here by stubbing that one call rather than standing up a live Postgres —
 * simulating a mis-provisioned `llame_search_stale_chats` (owned by a
 * non-BYPASSRLS role, or absent entirely, e.g. before migrations run) would
 * otherwise require reassigning the function's owner, which the RLS
 * integration harness cannot do connected as the non-superuser `app` role
 * (see apps/api/CLAUDE.md's `app_rls` section) — this is the lighter,
 * DB-free alternative the task called for.
 *
 * The worker runs through Nest's public bootstrap lifecycle in a TestingModule.
 * Queue setup resolves without invoking the registered consumer callbacks, so
 * the test covers boot behavior without starting an indefinite consumer.
 */

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TenantDbService } from '../db/tenant-db.service';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE } from '../queue/queue';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';
import { SearchIndexService } from './search-index.service';

type ProvisioningRow = { bypass: boolean };
type ProvisioningTx = { execute: () => Promise<ProvisioningRow[]> };
type PublicRunner = <T>(fn: (tx: ProvisioningTx) => Promise<T>) => Promise<T>;

const openModules: TestingModule[] = [];

function provisioned(rows: ProvisioningRow[]): PublicRunner {
  return <T>(fn: (tx: ProvisioningTx) => Promise<T>) =>
    fn({ execute: () => Promise.resolve(rows) });
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
      {
        provide: WorkerProfileService,
        useValue: { concurrencyFor: () => 1 },
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

  it('is silent when the function is owned by a BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(
      provisioned([{ bypass: true }]),
    );
    await check();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error (and does not throw) when owned by a non-BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(
      provisioned([{ bypass: false }]),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('BYPASSRLS');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error (and does not throw) when the function is absent', async () => {
    // No row at all — e.g. the migration creating llame_search_stale_chats
    // hasn't run yet.
    const { check, errorSpy } = await buildWorker(provisioned([]));
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('degrades to a warning (never throws) when the check itself fails to run', async () => {
    const { check, errorSpy, warnSpy } = await buildWorker(() =>
      Promise.reject(new Error('connection refused')),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('connection refused');
  });
});
