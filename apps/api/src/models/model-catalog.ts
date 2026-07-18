/**
 * Model catalog TYPES.
 *
 * The catalog itself is config-as-code (providers-and-models-as-code, #167):
 * entries live in `llame.config.json`'s `models[]`/`providers[]` arrays
 * (typed as `LlameConfig.models`/`LlameConfig.providers` in
 * `instance-config/llame-config.ts`) and are resolved by `ModelsService` at
 * boot — there is no compiled-in catalog array here anymore.
 *
 * Public ids are opaque llame ids. Provider execution ids are explicit
 * server-only configuration and must never be derived by parsing the public id.
 */

export type ModelSource = 'system';
export type SystemPromptSource = 'project_default' | 'model_override';

export type ModelPricingUsdPer1M = {
  input?: number;
  cachedInput?: number;
  output?: number;
};

export interface PublicModelCatalogEntry {
  id: string;
  source: ModelSource;
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  // Required, execution-critical (not display metadata): every executable model
  // MUST declare its context window. It travels onto the model client and sizes
  // the context-compaction trigger (× COMPACTION_WINDOW_RATIO); without it, long
  // chats on a small-window model would overflow before compaction ever fires.
  contextWindowTokens: number;
  pricingUsdPer1M?: ModelPricingUsdPer1M;
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
}

/**
 * The internal execution-side entry: adds the server-only provider reference
 * and the optional per-model compaction override, neither of which is
 * display metadata or exposed via `GET /api/v1/models` (same non-exposure
 * rule as `providerModelId`).
 */
export interface SystemModelCatalogEntry extends PublicModelCatalogEntry {
  /** References a `providers[].id` in the resolved instance config. */
  provider: string;
  providerModelId: string;
  /** Explicit per-model compaction trigger override; falls back to `contextWindowTokens x COMPACTION_WINDOW_RATIO` when absent. */
  compactionThresholdTokens?: number;
  /** Complete rendered prompt resolved once at boot; never exposed in the public model catalog. */
  systemPrompt: string;
  /** Path-free provenance for the resolved prompt. */
  systemPromptSource: SystemPromptSource;
}

/**
 * A single model's resolved pricing, carried on its `ModelClient` (see
 * `model-client.ts`) and consumed by turn-telemetry cost calculation. Unlike
 * `ModelPricingUsdPer1M` (optional per-field display metadata), `input`/
 * `output` are required here — pricing that can't compute a cost is simply
 * absent (`ModelClient.pricing === undefined`), not a partial `TokenPrice`.
 */
export type TokenPrice = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
};

/**
 * Strip the internal execution-only fields (`provider`, `providerModelId`,
 * `compactionThresholdTokens`, `systemPrompt`, `systemPromptSource`) from a catalog entry — what's left IS the
 * public shape, so a straight destructure-and-spread stays correct as
 * `PublicModelCatalogEntry` grows without needing a matching field-by-field
 * copy here.
 */
export function toPublicModel(
  model: SystemModelCatalogEntry,
): PublicModelCatalogEntry {
  const {
    provider: _provider,
    providerModelId: _providerModelId,
    compactionThresholdTokens: _compactionThresholdTokens,
    systemPrompt: _systemPrompt,
    systemPromptSource: _systemPromptSource,
    ...pub
  } = model;
  return pub;
}

/** Derive the resolved `TokenPrice` a client carries from a catalog entry's display pricing, or `undefined` when incomplete. */
export function toTokenPrice(
  pricing: ModelPricingUsdPer1M | undefined,
): TokenPrice | undefined {
  if (pricing?.input === undefined || pricing.output === undefined) {
    return undefined;
  }
  return {
    inputUsdPer1M: pricing.input,
    ...(pricing.cachedInput !== undefined
      ? { cachedInputUsdPer1M: pricing.cachedInput }
      : {}),
    outputUsdPer1M: pricing.output,
  };
}
