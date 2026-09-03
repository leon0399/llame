/**
 * discovery-provisioning unit tests (chat-search-embeddings/operations,
 * layer 7, review finding) — DB-free, faking `tenantDb.runAsPublic` (mirrors
 * `search-reindex.worker.test.ts`'s pattern for the exact same catalog
 * query: reassigning a function's owner needs superuser access the RLS
 * integration harness's non-superuser `app` role doesn't have, so simulating
 * an unprovisioned function is only practical this way).
 */
import {
  assertDiscoveryFunctionProvisioned,
  isFunctionOwnedByBypassRlsRole,
} from './discovery-provisioning';

type ProvisioningRow = { bypass: boolean };
type ProvisioningTx = { execute: () => Promise<Array<ProvisioningRow>> };

function fakeTenantDb(rows: Array<ProvisioningRow>) {
  return {
    runAsPublic: <T>(fn: (tx: ProvisioningTx) => Promise<T>) =>
      fn({ execute: () => Promise.resolve(rows) }),
  };
}

function throwingTenantDb(error: Error) {
  return {
    runAsPublic: () => Promise.reject(error),
  };
}

describe('isFunctionOwnedByBypassRlsRole', () => {
  it('is true when the catalog row reports bypass', async () => {
    await expect(
      isFunctionOwnedByBypassRlsRole(
        fakeTenantDb([{ bypass: true }]),
        'llame_search_embedding_coverage',
      ),
    ).resolves.toBe(true);
  });

  it('is false when the catalog row reports no bypass', async () => {
    await expect(
      isFunctionOwnedByBypassRlsRole(
        fakeTenantDb([{ bypass: false }]),
        'llame_search_embedding_coverage',
      ),
    ).resolves.toBe(false);
  });

  it('is false when the function does not exist at all (no matching row)', async () => {
    await expect(
      isFunctionOwnedByBypassRlsRole(fakeTenantDb([]), 'nonexistent_fn'),
    ).resolves.toBe(false);
  });
});

/**
 * The FATAL variant `backfill`/`coverage` use (review finding): must throw,
 * naming the missing provisioning step, rather than let an operator command
 * trust a silently empty cross-tenant result. Confirmed to fail first: with
 * `assertDiscoveryFunctionProvisioned` implemented as a no-op passthrough
 * (the pre-fix shape — no check at all), both "not provisioned" tests below
 * failed to throw.
 */
describe('assertDiscoveryFunctionProvisioned', () => {
  it('resolves silently when the function is BYPASSRLS-owned', async () => {
    await expect(
      assertDiscoveryFunctionProvisioned(
        fakeTenantDb([{ bypass: true }]),
        'llame_search_embedding_coverage',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws, naming the function, when it is not BYPASSRLS-owned', async () => {
    await expect(
      assertDiscoveryFunctionProvisioned(
        fakeTenantDb([{ bypass: false }]),
        'llame_search_embedding_report',
      ),
    ).rejects.toThrow(/llame_search_embedding_report/);
  });

  it("throws naming the fix ('db:provision-rls'), not just that it failed", async () => {
    await expect(
      assertDiscoveryFunctionProvisioned(
        fakeTenantDb([{ bypass: false }]),
        'llame_search_embedding_coverage',
      ),
    ).rejects.toThrow(/db:provision-rls/);
  });

  it('propagates a failure of the check itself rather than treating it as "fine"', async () => {
    await expect(
      assertDiscoveryFunctionProvisioned(
        throwingTenantDb(new Error('connection refused')),
        'llame_search_embedding_coverage',
      ),
    ).rejects.toThrow('connection refused');
  });
});
