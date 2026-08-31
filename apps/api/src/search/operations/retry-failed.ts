/**
 * `retry-failed` (chat-search-embeddings/operations, layer 7, task 7.4) —
 * clears recorded failures for the CURRENTLY configured `(modelId,
 * inputVersion)` so the next backfill/sweep pass re-attempts them.
 *
 * The suppression that keeps a terminally failed document from being
 * re-embedded forever comes ENTIRELY from the three `IS DISTINCT FROM`
 * checks on `embedding_model_key`/`embedded_content_hash`/
 * `embed_input_version` (search-embed.worker.ts's `embedGuardWhere`/
 * `persistEmbeddingFailure` doc comments) — `embedding_fail_reason`
 * contributes nothing to that predicate. Clearing only the reason would
 * therefore leave the document still suppressed and this command would
 * silently do nothing while reporting success. All four attempt-metadata
 * columns are cleared together here, resetting the row to "never attempted"
 * — exactly the state `llame_search_embedding_coverage`'s static branch
 * (`embedding IS NULL AND embedding_fail_reason IS NULL`) and the sweep's
 * `llame_search_embedding_backlog` both already recognize.
 *
 * Scoped to rows the coverage function's OWN `failed_count` bucket counts
 * for this `(modelId, inputVersion)` — `embedding_model_key = modelId AND
 * embedded_content_hash = content_hash AND embed_input_version =
 * inputVersion AND embedding_fail_reason IS NOT NULL` is the exact negation
 * of `needs_embedding` intersected with `has_failure` (see the coverage
 * function's own predicate). A document tombstoned under a DIFFERENT model
 * is already reported outstanding for `modelId` (its `embedding_model_key`
 * mismatch alone makes `needs_embedding` true), so it needs no clearing —
 * this command's job is exactly the failures that are otherwise invisible to
 * every automatic path.
 *
 * Same "no new SECURITY DEFINER discovery function for a write command"
 * reasoning as `prune.ts`: `forEachOwner` (`owner-write.ts`) iterates every
 * `users.id` (no RLS) and scopes each write through `runAs` — see that
 * file's header for the full correctness argument.
 */
import { sql } from 'drizzle-orm';

import type { TenantDbService } from '../../db/tenant-db.service';
import { forEachOwner, type OwnerWriteFailure } from './owner-write';

export type RetryFailedResult = {
  clearedDocuments: number;
  affectedOwners: number;
  /** Owners whose clear rejected; empty on full success. The caller must
   *  treat any non-empty result as a failed command — see
   *  `owner-write.ts`'s header. */
  failures: Array<OwnerWriteFailure>;
};

export async function retryFailedDocuments(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  modelId: string,
  inputVersion: number,
): Promise<RetryFailedResult> {
  const {
    total: clearedDocuments,
    affectedOwners,
    failures,
  } = await forEachOwner(tenantDb, (tx) =>
    tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding_model_key = NULL,
            embedded_content_hash = NULL,
            embed_input_version = NULL,
            embedding_fail_reason = NULL
        WHERE embedding_fail_reason IS NOT NULL
          AND embedding_model_key = ${modelId}
          AND embedded_content_hash = content_hash
          AND embed_input_version = ${inputVersion}
      `),
  );
  return { clearedDocuments, affectedOwners, failures };
}
