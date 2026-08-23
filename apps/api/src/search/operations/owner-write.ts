/**
 * Owner-iteration harness for cross-tenant WRITE operator commands
 * (chat-search-embeddings/operations, layer 7 — `prune`/`retry-failed`).
 *
 * `users` carries no RLS at all (no owner column, no policy), so listing
 * every id is safe under `runAsPublic` — but that is only the discovery
 * half. THE CORRECTNESS PROPERTY THIS FILE EXISTS TO CARRY: every actual
 * write below runs inside `tenantDb.runAs(ownerId, ...)`, which is the ONLY
 * non-BYPASSRLS way to touch a specific owner's rows under FORCE ROW LEVEL
 * SECURITY. That is deliberate, not incidental — the alternative shape every
 * READ path in this domain uses (a `SECURITY DEFINER` function discovers
 * identifiers cross-tenant, then an owner-scoped write acts on them) doesn't
 * fit a write command: if that discovery function were ever unprovisioned
 * (`pnpm db:provision-rls` not yet run), it would silently return zero
 * candidates and the command would report success having written nothing —
 * see `prune.ts`'s own header for the full argument. Iterating `users` and
 * scoping every write through `runAs` sidesteps that failure mode entirely:
 * an unprovisioned `app_rls` role simply doesn't matter here.
 *
 * Factored out of `prune.ts`/`retry-failed.ts`, which used to duplicate this
 * verbatim, differing only in the statement and the accumulator's field
 * name. Worth extracting for that correctness property, not the line count:
 * duplicated, it invites divergence in exactly the place where divergence is
 * a tenancy bug (e.g. one copy silently dropping the `runAs` scoping). A
 * future caller of this helper inherits the scoping automatically instead of
 * re-deriving it.
 */
import type { Db, TenantDbService } from '../../db/tenant-db.service';
import { users } from '../../db/schema/auth';

export type OwnerWriteResult = { total: number; affectedOwners: number };

/**
 * Runs `writeForOwner` once per user id, each inside its own
 * `tenantDb.runAs(ownerId, ...)` transaction, and accumulates the row
 * counts it returns. Most owners affect zero rows for a typical
 * `prune`/`retry-failed` scope — cheap, since the write is index-covered
 * (`search_chat_documents_owner_chat_idx`) and a zero-row `UPDATE` doesn't
 * count toward `affectedOwners`.
 */
export async function forEachOwner(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  writeForOwner: (tx: Db, ownerId: string) => Promise<{ count: number }>,
): Promise<OwnerWriteResult> {
  const owners = await tenantDb.runAsPublic((tx) =>
    tx.select({ id: users.id }).from(users),
  );

  let total = 0;
  let affectedOwners = 0;
  for (const { id } of owners) {
    const result = await tenantDb.runAs(id, (tx) => writeForOwner(tx, id));
    if (result.count > 0) {
      total += result.count;
      affectedOwners += 1;
    }
  }
  return { total, affectedOwners };
}
