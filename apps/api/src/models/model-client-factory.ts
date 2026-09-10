import type {
  OpenAICodexProviderConfig,
  OpenAIProviderConfig,
  ProviderConfig,
} from '../instance-config/llame-config';
import { toTokenPrice, type SystemModelCatalogEntry } from './model-catalog';
import type { ModelClient } from './model-client';
import { createOpenAICodexModelClient } from './openai-codex-model-client';
import { createOpenAIModelClient } from './openai-model-client';

type ModelClientDependencies = {
  createOpenAIModelClient: typeof createOpenAIModelClient;
  createOpenAICodexModelClient?: typeof createOpenAICodexModelClient;
};

/**
 * Type-dispatch client factory (providers-and-models-as-code, #167): the
 * seam that makes adding a provider `type` (e.g. a future Anthropic adapter)
 * a localized addition — one new case here, one new client module — rather
 * than a rework of `ModelsService`. Only `openai` is reachable today; the
 * config schema's `type` enum gates anything else at boot, so the `default`
 * branch below is defense-in-depth, not a runtime-reachable path while the
 * schema stays in sync with this switch.
 */
export function createModelClient(
  input: {
    provider: ProviderConfig;
    model: SystemModelCatalogEntry;
  },
  /**
   * Test seam (anti-slop/no-module-mocking): overrides the per-provider
   * client constructor instead of module-mocking `./openai-model-client`.
   * Production call sites never pass this — the default is the real
   * constructor.
   */
  dependencies: ModelClientDependencies = {
    createOpenAIModelClient,
    createOpenAICodexModelClient,
  },
): ModelClient {
  const { provider, model } = input;
  switch (provider.type) {
    case 'openai':
      return createOpenAIClient(provider, model, dependencies);
    case 'openai-codex':
      return createCodexClient(provider, model, dependencies);
    default: {
      // Unreachable while the JSON Schema's `providerType` enum stays in
      // sync with the cases above (config-loader rejects any other `type` at
      // boot) — kept as an internal error, not a silent fallback, in case
      // that sync ever drifts.
      const unsupported: never = provider;
      throw new Error(
        `No model client implementation for ${String(unsupported)}`,
      );
    }
  }
}

function createOpenAIClient(
  provider: OpenAIProviderConfig,
  model: SystemModelCatalogEntry,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenAIModelClient>[0] = {
    credential: provider.key ?? undefined,
    baseUrl: provider.baseUrl ?? undefined,
    nativeOpenAI: provider.id === 'openai',
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
  };
  assignModelMetadata(config, model);
  return dependencies.createOpenAIModelClient(config);
}

function createCodexClient(
  provider: OpenAICodexProviderConfig,
  model: SystemModelCatalogEntry,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenAICodexModelClient>[0] = {
    credential: provider.key,
    accountId: provider.accountId,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
  };
  assignModelMetadata(config, model);
  return (
    dependencies.createOpenAICodexModelClient ?? createOpenAICodexModelClient
  )(config);
}

function assignModelMetadata(
  config:
    | Parameters<typeof createOpenAIModelClient>[0]
    | Parameters<typeof createOpenAICodexModelClient>[0],
  model: SystemModelCatalogEntry,
): void {
  const pricing = toTokenPrice(model.pricingUsdPer1M);
  if (pricing !== undefined) config.pricing = pricing;
  if (model.compactionThresholdTokens !== undefined) {
    config.compactionThresholdTokens = model.compactionThresholdTokens;
  }
}
