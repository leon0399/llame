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
 *
 * BOUNDED CONCURRENCY, NOT SERIAL (efficiency finding). A plain sequential
 * `for...of` loop is 5,000 round trips for 5,000 users — seconds against
 * local Postgres, minutes against a networked one, and none of that latency
 * is required by the safety property above: each `runAs(ownerId, ...)` is
 * an INDEPENDENT transaction, so nothing about "loud failure, no silent
 * no-op" depends on running them one at a time. Batches 20-wide via
 * `Promise.allSettled` — the exact pattern `backfill.ts` already uses for
 * the same reason, which itself mirrors `search-reindex.worker.ts`'s
 * `enqueueRowsBounded`; this is the third use of that shape, not a new one.
 * `allSettled` (not `all`) is what makes the two properties below hold
 * simultaneously: one owner's rejection must not discard the other 19
 * outcomes in its batch, the same reason `backfill.ts` chose it.
 *
 * Split into two functions so the batching/accumulation logic — the part
 * with genuine new behavior — is unit-testable with a plain id array and a
 * fake `runAs` callback, with no Drizzle `Db` type to fake: `runOwnerBatches`
 * takes neither the query builder nor any SQL, only `ownerIds` and a
 * `(ownerId) => Promise<{count}>` callback. `forEachOwner` is the thin,
 * DB-touching wrapper `prune.ts`/`retry-failed.ts` actually call.
 */
import type { Db, TenantDbService } from '../../db/tenant-db.service';
import { users } from '../../db/schema/auth';

/** One owner whose write rejected. */
export type OwnerWriteFailure = { ownerId: string; message: string };

export type OwnerWriteResult = {
  total: number;
  affectedOwners: number;
  /** Owners whose write rejected; empty on a fully successful run. A
   *  non-empty result must be treated as a failed command — see this
   *  file's header — never folded into a lower `total`/`affectedOwners`. */
  failures: Array<OwnerWriteFailure>;
};

const CONCURRENCY = 20;

/**
 * The pure batching/accumulation core: runs `runAsOwner` once per id in
 * `ownerIds`, batched 20-wide via `Promise.allSettled`, and accumulates row
 * counts and failures. No Drizzle types anywhere — `runAsOwner` is already
 * the fully-bound "do the write for this one owner" callback.
 */
export async function runOwnerBatches(
  ownerIds: ReadonlyArray<string>,
  runAsOwner: (ownerId: string) => Promise<{ count: number }>,
): Promise<OwnerWriteResult> {
  let total = 0;
  let affectedOwners = 0;
  const failures: Array<OwnerWriteFailure> = [];
  for (let i = 0; i < ownerIds.length; i += CONCURRENCY) {
    const batch = ownerIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((ownerId) => runAsOwner(ownerId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.count > 0) {
          total += result.value.count;
          affectedOwners += 1;
        }
      } else {
        failures.push({
          ownerId: batch[index],
          message:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });
  }
  return { total, affectedOwners, failures };
}

/**
 * Runs `writeForOwner` once per user id, each inside its own
 * `tenantDb.runAs(ownerId, ...)` transaction — see `runOwnerBatches` for the
 * batching contract. Most owners affect zero rows for a typical
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
  return runOwnerBatches(
    owners.map((owner) => owner.id),
    (ownerId) => tenantDb.runAs(ownerId, (tx) => writeForOwner(tx, ownerId)),
  );
}
