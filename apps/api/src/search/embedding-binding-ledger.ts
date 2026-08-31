/**
 * The `embedding_model_bindings` ledger row — read and write — in one
 * neutral home (chat-search-embeddings, design D1). Relocated by review
 * (`/simplify`): the reader used to live in
 * `embedding-binding-boot-check.service.ts`, a file named for one specific
 * NestJS `OnApplicationBootstrap` consumer, even though `search-reindex.worker.ts`'s
 * embed-backlog sweep (design D6's gate) also needs it and has nothing to do
 * with boot checks. A file named `*-boot-check.service.ts` quietly becoming
 * the shared ledger-query util would make the name lie permanently for the
 * next consumer that goes looking. The writer (`ensureBindingLedgerRow`) has
 * no worker-specific dependencies either — only `Db` and the catalog entry —
 * so it belongs beside the reader rather than staying in
 * `search-embed.worker.ts`: one file owning both read and write of the same
 * row reads better than a reader in one place and a writer in another.
 *
 * Deliberately still DB-free at the TYPE level in the sense that matters:
 * `embedding-model-bindings.ts`'s comparison/validation logic stays
 * Postgres-free for its own unit tests (its header comment explains why),
 * and this file is exactly the Drizzle-backed reader that comment already
 * pointed to. Nothing here changes that split.
 */
import { eq } from 'drizzle-orm';

import { type Db } from '../db/tenant-db.service';
import { embeddingModelBindings } from '../db/schema/search';
import { type EmbeddingModelCatalogEntry } from '../instance-config/llame-config';

/**
 * Reads one ledger row by internal key. No tenant scoping —
 * `embedding_model_bindings` is instance-global operator state with no
 * tenant column and deliberately no RLS (see the table's header comment in
 * `db/schema/search.ts`). Two consumers: `EmbeddingBindingBootCheckService`
 * (boot-time consistency check) and `SearchReindexWorker`'s embed-backlog
 * sweep, which gates on the row's mere existence (design D1/D6 — no row
 * means the model has never embedded a real vector, so any outstanding
 * documents are bulk work, not incremental lag).
 */
export async function findEmbeddingBinding(tx: Db, modelKey: string) {
  const [row] = await tx
    .select()
    .from(embeddingModelBindings)
    .where(eq(embeddingModelBindings.modelKey, modelKey));
  return row;
}

/**
 * Ledger keys that have a binding row (a model that has embedded at least
 * once) but are absent from `declaredKeys` — i.e. models an operator has
 * undeclared. Read-only; consumed by `EmbeddingBindingBootCheckService`'s
 * non-fatal startup warning (chat-search-embeddings/operations, layer 7,
 * task 7.3) so undeclaring a model is visible even though its vectors are
 * deliberately left unread and undeleted until the operator runs `prune`.
 */
export async function listUndeclaredBindingKeys(
  tx: Db,
  declaredKeys: ReadonlyArray<string>,
): Promise<Array<string>> {
  const rows = await tx
    .select({ modelKey: embeddingModelBindings.modelKey })
    .from(embeddingModelBindings);
  const declared = new Set(declaredKeys);
  return rows.map((row) => row.modelKey).filter((key) => !declared.has(key));
}

/**
 * The binding ledger row (design D1) is written on the FIRST PERSISTED
 * vector for a key — never on declaration — so `search-embed.worker.ts`
 * calls this beside its persist path rather than at worker boot.
 * `onConflictDoNothing` makes every later call a no-op: the boot self-check
 * (`EmbeddingBindingBootCheckService`) already rejects a redefined-in-place
 * model before any worker runs, so by the time this executes, an existing
 * row is guaranteed consistent with what would be written here.
 *
 * The row's mere EXISTENCE also doubles as the signal
 * `SearchReindexWorker`'s embed-backlog sweep gates on (design D6): no row
 * means this model has never embedded anything for real, so any outstanding
 * documents under it are BULK work (a freshly declared model, or a corpus
 * newly pointed at one) — only the explicit `backfill` command may start
 * that, never a config edit via the automatic sweep.
 */
export async function ensureBindingLedgerRow(
  tx: Db,
  model: EmbeddingModelCatalogEntry,
): Promise<void> {
  await tx
    .insert(embeddingModelBindings)
    .values({
      modelKey: model.id,
      providerId: model.provider,
      providerModelId: model.providerModelId,
      revision: model.revision ?? null,
      dimensions: model.dimensions,
      distanceMetric: model.distanceMetric,
      documentPrefix: model.documentPrefix ?? null,
      queryPrefix: model.queryPrefix ?? null,
      batchSize: model.batchSize,
    })
    .onConflictDoNothing({ target: embeddingModelBindings.modelKey });
}
