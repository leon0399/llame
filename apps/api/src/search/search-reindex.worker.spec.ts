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
 * The method is private; it's invoked here via a narrow cast rather than
 * running the full `onApplicationBootstrap` (which also starts consuming
 * queues indefinitely and is out of scope for this check).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */

import { Logger } from '@nestjs/common';

import type { TenantDbService } from '../db/tenant-db.service';
import type { Queue } from '../queue/queue';
import { noopReindexDispatch } from './search-reindex-dispatch.stub';
import { SearchReindexWorker } from './search-reindex.worker';
import type { SearchIndexService } from './search-index.service';

type Provisioned = { assertDiscoveryProvisioned: () => Promise<void> };

function buildWorker(
  runAsPublic: (fn: (tx: any) => Promise<any>) => Promise<any>,
) {
  const tenantDb = { runAsPublic } as unknown as TenantDbService;
  const worker = new SearchReindexWorker(
    {} as unknown as Queue,
    tenantDb,
    {} as unknown as SearchIndexService,
    noopReindexDispatch(),
  );
  const logger = (worker as unknown as { logger: Logger }).logger;
  const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  const check = (
    worker as unknown as Provisioned
  ).assertDiscoveryProvisioned.bind(worker);
  return { check, errorSpy, warnSpy };
}

describe('SearchReindexWorker.assertDiscoveryProvisioned', () => {
  it('is silent when the function is owned by a BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = buildWorker(async (fn) =>
      fn({ execute: async () => [{ bypass: true }] } as any),
    );
    await check();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error (and does not throw) when owned by a non-BYPASSRLS role', async () => {
    const { check, errorSpy, warnSpy } = buildWorker(async (fn) =>
      fn({ execute: async () => [{ bypass: false }] } as any),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('BYPASSRLS');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a loud error (and does not throw) when the function is absent', async () => {
    // No row at all — e.g. the migration creating llame_search_stale_chats
    // hasn't run yet.
    const { check, errorSpy } = buildWorker(async (fn) =>
      fn({ execute: async () => [] } as any),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('degrades to a warning (never throws) when the check itself fails to run', async () => {
    const { check, errorSpy, warnSpy } = buildWorker(async () => {
      throw new Error('connection refused');
    });
    await expect(check()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('connection refused');
  });
});
