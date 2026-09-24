import type {
  AnthropicMessagesProviderConfig,
  OpenAICodexProviderConfig,
  OpenCodeGoProviderConfig,
  OpenAICompletionsProviderConfig,
  OpenAIResponsesProviderConfig,
  ProviderConfig,
} from '../instance-config/llame-config';
import { toTokenPrice, type SystemModelCatalogEntry } from './model-catalog';
import type { ModelClient } from './model-client';
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicModelClient,
} from './anthropic-model-client';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import { createOpenAICodexModelClient } from './openai-codex-model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { createOpenCodeGoModelClient } from './opencode-go-model-client';

type ModelClientDependencies = {
  createOpenAIModelClient: typeof createOpenAIModelClient;
  createOpenAICompletionsModelClient?: typeof createOpenAICompletionsModelClient;
  createOpenAICodexModelClient?: typeof createOpenAICodexModelClient;
  createAnthropicModelClient?: typeof createAnthropicModelClient;
  createOpenCodeGoModelClient?: typeof createOpenCodeGoModelClient;
};

/**
 * Type-dispatch client factory (providers-and-models-as-code, #167): the
 * seam that makes adding a provider `type` a localized addition — one new
 * case here, one new client module — rather than a rework of
 * `ModelsService`. The wire is a property of the client the `type` selects,
 * never inferred from an `id`, a `baseUrl`, or a host
 * (design D1). The config schema's `type` enum gates anything else at boot,
 * so the `default` branch below is defense-in-depth, not a
 * runtime-reachable path while the schema stays in sync with this switch.
 */
export function createModelClient(
  input: {
    provider: ProviderConfig;
    model: SystemModelCatalogEntry;
    /**
     * llame's product token and version (`llame/<version>`), read once at
     * boot under the instance-configuration contract (design D6) and threaded
     * into every client config, which sends it per call.
     */
    userAgent: string;
  },
  /**
   * Test seam (anti-slop/no-module-mocking): overrides the per-provider
   * client constructor instead of module-mocking the client modules.
   * Production call sites never pass this — the default is the real
   * constructor.
   */
  dependencies: ModelClientDependencies = {
    createOpenAIModelClient,
    createOpenAICompletionsModelClient,
    createOpenAICodexModelClient,
    createOpenCodeGoModelClient,
  },
): ModelClient {
  const { provider, model, userAgent } = input;
  switch (provider.type) {
    case 'openai-responses':
      return createResponsesClient(provider, model, userAgent, dependencies);
    case 'openai-completions':
      return createCompletionsClient(provider, model, userAgent, dependencies);
    case 'anthropic-messages':
      return createMessagesClient(provider, model, userAgent, dependencies);
    case 'openai-codex':
      return createCodexClient(provider, model, userAgent, dependencies);
    case 'opencode-go':
      return createOpenCodeGoClient(provider, model, userAgent, dependencies);
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

function createResponsesClient(
  provider: OpenAIResponsesProviderConfig,
  model: SystemModelCatalogEntry,
  userAgent: string,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenAIModelClient>[0] = {
    credential: provider.key ?? undefined,
    baseUrl: provider.baseUrl ?? undefined,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    userAgent,
  };
  assignModelMetadata(config, model);
  return dependencies.createOpenAIModelClient(config);
}

function createCompletionsClient(
  provider: OpenAICompletionsProviderConfig,
  model: SystemModelCatalogEntry,
  userAgent: string,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenAICompletionsModelClient>[0] = {
    credential: provider.key ?? undefined,
    baseUrl: provider.baseUrl,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    userAgent,
  };
  assignModelMetadata(config, model);
  return (
    dependencies.createOpenAICompletionsModelClient ??
    createOpenAICompletionsModelClient
  )(config);
}
function createMessagesClient(
  provider: AnthropicMessagesProviderConfig,
  model: SystemModelCatalogEntry,
  userAgent: string,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createAnthropicModelClient>[0] = {
    credential: provider.key ?? undefined,
    // Always explicit (anthropic-provider D3): the configured endpoint, or
    // the Anthropic API when the entry configures none — never omitted, so
    // the adapter's `ANTHROPIC_BASE_URL` environment fallback never applies.
    baseUrl: provider.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    userAgent,
    // The client's adaptive-thinking default is gated on the entry's
    // `reasoning` declaration (D11): presence of the vocabulary is the
    // declaration, so this boolean is the whole signal the client needs.
    reasoningDeclared: model.reasoning !== undefined,
  };
  assignModelMetadata(config, model);
  return (
    dependencies.createAnthropicModelClient ?? createAnthropicModelClient
  )(config);
}

function createCodexClient(
  provider: OpenAICodexProviderConfig,
  model: SystemModelCatalogEntry,
  userAgent: string,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenAICodexModelClient>[0] = {
    credential: provider.key,
    accountId: provider.accountId,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    userAgent,
  };
  assignModelMetadata(config, model);
  return (
    dependencies.createOpenAICodexModelClient ?? createOpenAICodexModelClient
  )(config);
}

function createOpenCodeGoClient(
  provider: OpenCodeGoProviderConfig,
  model: SystemModelCatalogEntry,
  userAgent: string,
  dependencies: ModelClientDependencies,
): ModelClient {
  const config: Parameters<typeof createOpenCodeGoModelClient>[0] = {
    credential: provider.key,
    providerModelId: model.providerModelId,
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    userAgent,
  };
  assignModelMetadata(config, model);
  return (
    dependencies.createOpenCodeGoModelClient ?? createOpenCodeGoModelClient
  )(config);
}

function assignModelMetadata(
  config:
    | Parameters<typeof createOpenAIModelClient>[0]
    | Parameters<typeof createOpenAICompletionsModelClient>[0]
    | Parameters<typeof createAnthropicModelClient>[0]
    | Parameters<typeof createOpenAICodexModelClient>[0]
    | Parameters<typeof createOpenCodeGoModelClient>[0],
  model: SystemModelCatalogEntry,
): void {
  const pricing = toTokenPrice(model.pricingUsdPer1M);
  if (pricing !== undefined) config.pricing = pricing;
  if (model.billing !== undefined) config.billing = model.billing;
  if (model.compactionThresholdTokens !== undefined) {
    config.compactionThresholdTokens = model.compactionThresholdTokens;
  }
  // The operator's provider-options object and the catalog output limit ride
  // the model entry, not the provider entry (provider-api-selection): every
  // client unwraps them from its own config at request time. Copied by
  // reference like the resolved entry the loader already retains — overloads
  // stay absent here, so a client without the option simply never sends it.
  if (model.providerOptions !== undefined) {
    config.providerOptions = model.providerOptions;
  }
  if (model.maxOutputTokens !== undefined) {
    config.maxOutputTokens = model.maxOutputTokens;
  }
}
