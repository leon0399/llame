/**
 * The embedding-model binding ledger check (chat-search-embeddings, design
 * D1). One row per internal key is written on the FIRST PERSISTED vector for
 * that key — never on declaration (a later layer's job) — so a
 * declared-but-never-used key can be corrected freely. A declared key whose
 * existing ledger row was produced under a different binding is rejected at
 * load, naming the key and the changed field: the ledger is what turns
 * silent embedding-space mixing under one key into a startup failure instead
 * of corrupted ranking.
 *
 * The comparison logic here takes its `EmbeddingBindingLookup` as a plain
 * interface rather than reaching for Postgres directly, so it and its unit
 * tests need no database — the real Drizzle-backed reader lives in
 * `embedding-binding-boot-check.service.ts`.
 */
import { InstanceConfigError } from '@workspace/config-interpolation';
import type { EmbeddingModelCatalogEntry } from '../instance-config/llame-config';
import type { EmbeddingModelBinding } from '../db/schema/search';

/**
 * The fields that identify the embedding space a key's stored vectors were
 * produced under. `batchSize` is deliberately excluded — a throughput knob,
 * not part of the embedding space, so tuning it must never trigger this
 * rejection.
 */
const BINDING_COMPARISON_FIELDS = [
  'providerId',
  'providerModelId',
  'revision',
  'dimensions',
  'distanceMetric',
  'documentPrefix',
  'queryPrefix',
] as const;

/** Projects a declared model onto the ledger's comparison shape, normalizing an absent optional field (`undefined`) to `null` so it compares fairly against the nullable ledger columns. Return type left inferred (anti-slop/no-known-value-widening) rather than annotated to the open `Record<BindingComparisonField, ...>` shape. */
function toComparisonRecord(declared: EmbeddingModelCatalogEntry) {
  return {
    providerId: declared.provider,
    providerModelId: declared.providerModelId,
    revision: declared.revision ?? null,
    dimensions: declared.dimensions,
    distanceMetric: declared.distanceMetric,
    documentPrefix: declared.documentPrefix ?? null,
    queryPrefix: declared.queryPrefix ?? null,
  };
}

/** The read side of the binding ledger — a caller-supplied lookup, so this module and its tests need no Postgres. */
export type EmbeddingBindingLookup = {
  findBinding(modelKey: string): Promise<EmbeddingModelBinding | undefined>;
};

/**
 * Reject a declared embedding model whose ledger row (if any) was produced
 * under a different binding. No row yet (first use, or a declared-but-never-
 * embedded key) always passes — there is nothing to conflict with. Never
 * names the changed VALUE, only the key and field: a dangling reference
 * could otherwise leak a resolved value (same discipline as the config
 * loader's dangling-reference errors).
 */
export function assertBindingConsistent(
  declared: EmbeddingModelCatalogEntry,
  existing: EmbeddingModelBinding | undefined,
): void {
  if (!existing) return;
  const declaredRecord = toComparisonRecord(declared);
  for (const field of BINDING_COMPARISON_FIELDS) {
    if (declaredRecord[field] !== existing[field]) {
      throw new InstanceConfigError(
        `embeddingModels[${declared.id}].${field}: differs from the binding already recorded for this key — vectors already stored under it were produced by a different configuration. Redefine the changed model under a new id instead.`,
      );
    }
  }
}

/**
 * Validate every declared embedding model against its ledger row, if any.
 * Issues no lookup at all when `models` is empty (off-by-default contract).
 */
export async function assertDeclaredBindingsConsistent(
  models: ReadonlyArray<EmbeddingModelCatalogEntry>,
  ledger: EmbeddingBindingLookup,
): Promise<void> {
  for (const model of models) {
    const existing = await ledger.findBinding(model.id);
    assertBindingConsistent(model, existing);
  }
}
