/**
 * `prune` (chat-search-embeddings/operations, layer 7, task 7.3) — deletes
 * vectors (and their attempt metadata) of a model no longer declared in
 * `embeddingModels[]`, AND retires that key's `embedding_model_bindings`
 * ledger row. Undeclaring a model on its own leaves both completely alone:
 * neither is ever read (no query anywhere compares against an arbitrary
 * undeclared key) or deleted except by this explicit command — a config edit
 * must never delete data.
 *
 * THE LEDGER ROW MUST GO TOO, not just the vectors: `EmbeddingBindingBootCheckService`'s
 * undeclared-key warning is driven purely by ledger-row presence
 * (`listUndeclaredBindingKeys`), so leaving the row behind after pruning its
 * vectors would make that warning fire forever, permanently claiming the key
 * "has stored vectors" after none remain, and would leave a future
 * re-declaration of the same id under different provider params rejected by
 * `assertBindingConsistent` even though nothing is left to conflict with.
 * `embedding_model_bindings` is instance-global with no tenant column and
 * deliberately no RLS (same as `findEmbeddingBinding`/
 * `listUndeclaredBindingKeys`), so this DELETE runs once under `runAsPublic`,
 * not per-owner.
 *
 * NO NEW SECURITY DEFINER DISCOVERY FUNCTION for the per-owner vector sweep.
 * Every other cross-tenant operation in this domain (coverage, backlog, and
 * this layer's `report`) follows the same two-step shape: a BYPASSRLS
 * function discovers identifiers, then an ordinary owner-scoped `runAs`
 * write acts on them. That shape doesn't fit a WRITE command well: if the
 * discovery function is ever unprovisioned (`pnpm db:provision-rls` not yet
 * run), it silently returns zero candidates and this command would report
 * success having pruned nothing — exactly the "looks fine, does nothing"
 * failure the brief calls out for `retry-failed`. `forEachOwner`
 * (`owner-write.ts`) iterates every `users` id instead (no RLS, no
 * BYPASSRLS surface to leave unprovisioned) and scopes each write through
 * `runAs` — see that file's header for the full correctness argument.
 */
import { sql } from 'drizzle-orm';

import type { TenantDbService } from '../../db/tenant-db.service';
import { forEachOwner, type OwnerWriteFailure } from './owner-write';

export type PruneResult = {
  prunedDocuments: number;
  affectedOwners: number;
  retiredBindings: number;
  /** Owners whose vector clear rejected; empty on full success. The caller
   *  must treat any non-empty result as a failed command (see
   *  `owner-write.ts`'s header) — the ledger row is still retired
   *  regardless, since it is a separate global operation, not per-owner. */
  failures: Array<OwnerWriteFailure>;
};

/**
 * Clears all five embedding columns (embedding, embedding_model_key,
 * embedded_content_hash, embed_input_version, embedding_fail_reason) for
 * every document whose `embedding_model_key` names a model NOT in
 * `declaredModelKeys` — vectors AND tombstoned failures alike, since both
 * are stamped with the model they were attempted against. Never touches a
 * row under a currently declared key. `declaredModelKeys = []` (embedding
 * layer fully undeclared) correctly prunes every embedded/attempted row,
 * since every non-null key is then "not any declared key."
 */
// `<> ALL(${array})` does not bind a JS array as a Postgres array parameter
// through this driver (verified empirically: postgres.js sends it as a
// single text-array-typed parameter whose serialized value is the array's
// own elements joined without the `{...}` envelope, which Postgres then
// rejects as a malformed array literal). `NOT IN (v1, v2, ...)` — one bind
// parameter per declared key via `sql.join` — sidesteps that entirely. An
// empty declared set has no valid `IN (...)` form (bare `()` is a syntax
// error), so it collapses to `TRUE`: every non-null key is then "not
// declared," which is the correct semantics.
function notInDeclared(
  column: ReturnType<typeof sql>,
  declaredModelKeys: ReadonlyArray<string>,
) {
  return declaredModelKeys.length === 0
    ? sql`TRUE`
    : sql`${column} NOT IN (${sql.join(
        declaredModelKeys.map((key) => sql`${key}`),
        sql`, `,
      )})`;
}

export async function pruneUndeclaredModelVectors(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  declaredModelKeys: ReadonlyArray<string>,
): Promise<PruneResult> {
  const {
    total: prunedDocuments,
    affectedOwners,
    failures,
  } = await forEachOwner(tenantDb, (tx) =>
    tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = NULL,
            embedding_model_key = NULL,
            embedded_content_hash = NULL,
            embed_input_version = NULL,
            embedding_fail_reason = NULL
        WHERE embedding_model_key IS NOT NULL
          AND ${notInDeclared(sql`embedding_model_key`, declaredModelKeys)}
      `),
  );

  // Retire the ledger row for every undeclared key — see this file's header
  // for why leaving it behind after clearing the vectors is itself a bug.
  // `embedding_model_bindings` carries no tenant column and no RLS, so this
  // is one global DELETE, not a per-owner loop.
  // ...but ONLY once every owner's vectors are actually gone. The ledger row
  // is what keeps an orphan discoverable: the boot check's warning is driven
  // by its presence, and `assertBindingConsistent` uses it to refuse a
  // redeclaration of the same id under different provider parameters.
  // Retiring it while some owner still holds vectors under that key would
  // silence the warning about the very rows the failure just left behind, and
  // let the id be redefined as a different model with those rows still in the
  // table. A partial prune must stay visibly unfinished and re-runnable.
  const retired =
    failures.length === 0
      ? await tenantDb.runAsPublic((tx) =>
          tx.execute(sql`
            DELETE FROM embedding_model_bindings
            WHERE ${notInDeclared(sql`model_key`, declaredModelKeys)}
          `),
        )
      : { count: 0 };

  return {
    prunedDocuments,
    affectedOwners,
    retiredBindings: retired.count,
    failures,
  };
}
