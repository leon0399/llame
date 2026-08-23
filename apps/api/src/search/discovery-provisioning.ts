/**
 * Shared BYPASSRLS-provisioning check for the cross-tenant SECURITY DEFINER
 * discovery functions in this domain (`llame_search_stale_chats`,
 * `llame_search_embedding_coverage`, `llame_search_embedding_backlog`,
 * `llame_search_embedding_report`). Each must be owned by a BYPASSRLS role
 * (`app_rls`) to see rows across tenants under FORCE RLS; until
 * `pnpm db:provision-rls` reassigns it there from `app`, it silently returns
 * zero rows and cross-tenant discovery for that function is disabled with no
 * error anywhere else — this is the one place that failure mode is turned
 * into something visible.
 *
 * Non-circular: reads `pg_proc`/`pg_roles` catalog metadata, never tenant
 * data, so it never hits the RLS wall it's checking for.
 *
 * Two callers, two policies, both built on the same read:
 * - `SearchReindexWorker`'s boot self-check is NON-FATAL (a backfill-only
 *   degradation; new activity still indexes synchronously via Tier 1) —
 *   it logs and continues.
 * - The `search:backfill`/`search:coverage` operator commands (chat-search-
 *   embeddings/operations, layer 7) are FATAL: a worker degrading to
 *   lexical-only is a partial service, but an operator command silently
 *   reporting an empty/zero result for "is anything outstanding or failed"
 *   is a WRONG ANSWER to a direct question, not a degradation. `prune`/
 *   `retry-failed` need no check here at all — they deliberately don't read
 *   through a SECURITY DEFINER function (see `prune.ts`'s header), so an
 *   unprovisioned `app_rls` role cannot make them silently under-report.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';

/** One `pg_proc`/`pg_roles` catalog row. */
type ProvisioningRow = { bypass: boolean };

/**
 * The minimal capability this check needs from `TenantDbService` — narrowed
 * to exactly the one query shape it issues (#268 "narrow the dependency, not
 * the fake"), same reasoning as `backfill.ts`'s `CoverageQueryRunner`: the
 * real `Pick<TenantDbService, 'runAsPublic'>`'s callback parameter is the
 * full Drizzle `Db` type, which a unit test cannot construct a structural
 * fake for without a cast. The real `TenantDbService` satisfies this
 * narrower shape automatically.
 */
export type ProvisioningQueryRunner = {
  runAsPublic<T>(
    fn: (tx: {
      execute: (query: SQLWrapper) => Promise<Iterable<ProvisioningRow>>;
    }) => Promise<T>,
  ): Promise<T>;
};

/** True when `functionName` is currently owned by a role with BYPASSRLS —
 *  the provisioning state `pnpm db:provision-rls` establishes. */
export async function isFunctionOwnedByBypassRlsRole(
  tenantDb: ProvisioningQueryRunner,
  functionName: string,
): Promise<boolean> {
  const result = await tenantDb.runAsPublic((tx) =>
    tx.execute(sql`
      SELECT r.rolbypassrls AS bypass
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = ${functionName}
    `),
  );
  const row = [...result][0];
  return Boolean(row?.bypass);
}

/**
 * FATAL variant for operator read commands: throws (rather than logging)
 * when `functionName` is not BYPASSRLS-owned, naming the missing
 * provisioning step. Also throws if the check itself fails to run (e.g. no
 * database reachable) — that is not a case where printing a reassuring
 * empty result is acceptable either.
 */
export async function assertDiscoveryFunctionProvisioned(
  tenantDb: ProvisioningQueryRunner,
  functionName: string,
): Promise<void> {
  const provisioned = await isFunctionOwnedByBypassRlsRole(
    tenantDb,
    functionName,
  );
  if (!provisioned) {
    throw new Error(
      `Discovery function '${functionName}' is not owned by a BYPASSRLS role — its cross-tenant results would be silently empty, not truly empty. Run 'pnpm db:provision-rls' (or your deployment's equivalent) and re-run this command.`,
    );
  }
}
