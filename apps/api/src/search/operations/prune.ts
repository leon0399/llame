/**
 * `prune` (chat-search-embeddings/operations, layer 7, task 7.3) — deletes
 * vectors (and their attempt metadata) of a model no longer declared in
 * `embeddingModels[]`. Undeclaring a model on its own leaves those rows
 * completely alone: they are never read (no query anywhere compares against
 * an arbitrary undeclared key) and never deleted except by this explicit
 * command — a config edit must never delete data.
 *
 * NO NEW SECURITY DEFINER DISCOVERY FUNCTION. Every other cross-tenant
 * operation in this domain (coverage, backlog, and this layer's `report`)
 * follows the same two-step shape: a BYPASSRLS function discovers
 * identifiers, then an ordinary owner-scoped `runAs` write acts on them. That
 * shape doesn't fit a WRITE command well: if the discovery function is ever
 * unprovisioned (`pnpm db:provision-rls` not yet run), it silently returns
 * zero candidates and this command would report success having pruned
 * nothing — exactly the "looks fine, does nothing" failure the brief calls
 * out for `retry-failed`. `users` carries no RLS at all (no owner column, no
 * policy), so this iterates every user id and issues one ordinary
 * owner-scoped `UPDATE` per user instead — most affecting zero rows, cheap
 * (the owner+chat index covers it), and with no BYPASSRLS surface to leave
 * unprovisioned: an unmigrated `app_rls` role simply doesn't matter here.
 */
import { sql } from 'drizzle-orm';

import { users } from '../../db/schema/auth';
import type { TenantDbService } from '../../db/tenant-db.service';

export type PruneResult = { prunedDocuments: number; affectedOwners: number };

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
export async function pruneUndeclaredModelVectors(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  declaredModelKeys: readonly string[],
): Promise<PruneResult> {
  const owners = await tenantDb.runAsPublic((tx) =>
    tx.select({ id: users.id }).from(users),
  );

  // `<> ALL(${array})` does not bind a JS array as a Postgres array
  // parameter through this driver (verified empirically: postgres.js sends
  // it as a single text-array-typed parameter whose serialized value is the
  // array's own elements joined without the `{...}` envelope, which
  // Postgres then rejects as a malformed array literal). `NOT IN (v1, v2,
  // ...)` — one bind parameter per declared key via `sql.join` — sidesteps
  // that entirely. An empty declared set has no valid `IN (...)` form (bare
  // `()` is a syntax error), so it collapses to `TRUE`: every non-null key
  // is then "not declared," which is the correct semantics.
  const notDeclared =
    declaredModelKeys.length === 0
      ? sql`TRUE`
      : sql`embedding_model_key NOT IN (${sql.join(
          declaredModelKeys.map((key) => sql`${key}`),
          sql`, `,
        )})`;

  let prunedDocuments = 0;
  let affectedOwners = 0;
  for (const { id } of owners) {
    const result = await tenantDb.runAs(id, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = NULL,
            embedding_model_key = NULL,
            embedded_content_hash = NULL,
            embed_input_version = NULL,
            embedding_fail_reason = NULL
        WHERE embedding_model_key IS NOT NULL
          AND ${notDeclared}
      `),
    );
    if (result.count > 0) {
      prunedDocuments += result.count;
      affectedOwners += 1;
    }
  }
  return { prunedDocuments, affectedOwners };
}
