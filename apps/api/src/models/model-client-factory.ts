import type { ProviderConfig } from '../instance-config/llame-config';
import { toTokenPrice, type SystemModelCatalogEntry } from './model-catalog';
import type { ModelClient } from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

/**
 * Type-dispatch client factory (providers-and-models-as-code, #167): the
 * seam that makes adding a provider `type` (e.g. a future Anthropic adapter)
 * a localized addition — one new case here, one new client module — rather
 * than a rework of `ModelsService`. Only `openai` is reachable today; the
 * config schema's `type` enum gates anything else at boot, so the `default`
 * branch below is defense-in-depth, not a runtime-reachable path while the
 * schema stays in sync with this switch.
 */
export function createModelClient(input: {
  provider: ProviderConfig;
  model: SystemModelCatalogEntry;
}): ModelClient {
  const { provider, model } = input;
  const pricing = toTokenPrice(model.pricingUsdPer1M);

  switch (provider.type) {
    case 'openai':
      return createOpenAIModelClient({
        credential: provider.key ?? undefined,
        baseUrl: provider.baseUrl ?? undefined,
        nativeOpenAI: provider.id === 'openai',
        providerModelId: model.providerModelId,
        modelId: model.id,
        contextWindowTokens: model.contextWindowTokens,
        ...(pricing !== undefined ? { pricing } : {}),
        ...(model.compactionThresholdTokens !== undefined
          ? { compactionThresholdTokens: model.compactionThresholdTokens }
          : {}),
      });
    default: {
      // Unreachable while the JSON Schema's `providerType` enum stays in
      // sync with the cases above (config-loader rejects any other `type` at
      // boot) — kept as an internal error, not a silent fallback, in case
      // that sync ever drifts.
      const unsupported: never = provider.type;
      throw new Error(
        `No model client implementation for provider type "${String(unsupported)}"`,
      );
    }
  }
}
