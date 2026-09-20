import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import {
  streamText,
  type OutputInterface,
  type StreamTextResult,
  type ToolSet,
} from 'ai';

import {
  type ModelClient,
  type ModelObjectInput,
  type ModelStreamInput,
} from './model-client';
import type { TokenPrice } from './model-catalog';
import {
  type ProviderOptionRecord,
  composeProviderOptions,
} from './provider-options';
import {
  applyToolCallingOptions,
  awaitSettlementAfter,
  generateToolBoundObject,
  KEYLESS_PLACEHOLDER_API_KEY,
  trackAbortSettlement,
} from './openai-model-client';

/**
 * Wire identity of this adapter: `@ai-sdk/openai-compatible` is Chat
 * Completions only, so it doubles as the client's public `provider` label.
 */
const COMPATIBLE_PROVIDER_NAME = 'openai-completions';

export type OpenAICompletionsModelClientConfig = {
  credential?: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
  /** Required: the compatible adapter has no default endpoint. */
  baseUrl: string;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
  /**
   * Operator-authored provider-native options, keyed as the adapter
   * documents them (provider-api-selection): carried by the factory from
   * the model entry and merged with the run's effort at request time, not
   * sent verbatim.
   */
  providerOptions?: ProviderOptionRecord;
  /** Optional catalog output limit, forwarded as the request's `maxOutputTokens` setting. */
  maxOutputTokens?: number;
};

/**
 * Test seam (anti-slop/no-module-mocking): overrides the AI SDK's
 * provider-factory and streaming entry points instead of module-mocking
 * `@ai-sdk/openai-compatible`/`ai`. Production call sites never pass this —
 * the default is the real SDK.
 */
export type OpenAICompletionsModelClientDependencies = {
  createOpenAICompatible: typeof createOpenAICompatible;
  streamText: (
    options: Parameters<typeof streamText>[0],
  ) => StreamTextResult<ToolSet, OutputInterface<string, string, never>>;
};

function composeCompletionsOptions(
  config: OpenAICompletionsModelClientConfig,
  input: ModelStreamInput,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  // Composed request options (provider-api-selection D5): the operator's
  // object under the run's effort as `reasoningEffort`, no defaults and no
  // invariants on this wire. `model`, `max_tokens`, and `tool_choice` are
  // reserved — the adapter spreads unknown keys over them into the request
  // body, so an operator key would retarget the request — and `max_tokens`
  // in particular stays the catalog output limit's seat, never an option's.
  const composed = composeProviderOptions({
    operator: config.providerOptions,
    ...(input.effort !== undefined && {
      effort: { reasoningEffort: input.effort },
    }),
    reservedPaths: ['model', 'max_tokens', 'tool_choice'],
  });
  if (composed === undefined) {
    return {};
  }
  return { providerOptions: { openaiCompletions: composed } };
}

function runOpenAICompatibleStream(
  provider: OpenAICompatibleProvider,
  config: OpenAICompletionsModelClientConfig,
  dependencies: OpenAICompletionsModelClientDependencies,
  input: ModelStreamInput,
) {
  const settlement = trackAbortSettlement(input);
  const providerOptions = composeCompletionsOptions(config, input);
  const streamOptions: Parameters<typeof streamText>[0] = {
    // Chat Completions at the entry's required base URL (design D1): the
    // compatible provider callable is that wire's chat model.
    model: provider(config.providerModelId),
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    onError: input.onError,
    onAbort: settlement.onAbort,
    onFinish: input.onFinish,
    ...providerOptions,
    // The catalog output limit, provider-neutral like `providerOptions`:
    // the adapter derives the wire's `max_tokens` from this setting.
    ...(config.maxOutputTokens !== undefined && {
      maxOutputTokens: config.maxOutputTokens,
    }),
  };
  // The shared tool loop (the SDK auto-executes tools and re-calls the
  // model): without these settings `streamText` stops after one step, so a
  // tool-requesting step would end the turn with no text at all.
  applyToolCallingOptions(streamOptions, input);
  if (input.onTextDelta || input.onReasoningDelta) {
    streamOptions.onChunk = ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        input.onTextDelta?.(chunk.text);
      } else if (chunk.type === 'reasoning-delta') {
        input.onReasoningDelta?.(chunk.text, chunk.id);
      }
    };
  }
  return awaitSettlementAfter(
    dependencies.streamText(streamOptions),
    settlement,
  );
}

/**
 * Creates a model client for streaming text against the Chat Completions
 * wire through `@ai-sdk/openai-compatible` — the declared wire of a
 * `type: 'openai-completions'` provider entry, at its required `baseUrl`.
 *
 * `modelId` is the opaque llame id used for telemetry and API events.
 * `providerModelId` is the server-only model id sent to the provider.
 * @returns A model client that streams text using the configured model
 */
export function createOpenAICompletionsModelClient(
  config: OpenAICompletionsModelClientConfig,
  dependencies: OpenAICompletionsModelClientDependencies = {
    createOpenAICompatible,
    streamText,
  },
): ModelClient {
  const provider = dependencies.createOpenAICompatible({
    name: COMPATIBLE_PROVIDER_NAME,
    baseURL: config.baseUrl,
    // A keyless provider still needs a non-empty apiKey passed through —
    // see KEYLESS_PLACEHOLDER_API_KEY.
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
  });

  return {
    model: config.modelId,
    provider: COMPATIBLE_PROVIDER_NAME,
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined && { pricing: config.pricing }),
    ...(config.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: config.compactionThresholdTokens,
    }),
    streamText: (input: ModelStreamInput) =>
      runOpenAICompatibleStream(provider, config, dependencies, input),
    generateObject: <OBJECT>(input: ModelObjectInput<OBJECT>) =>
      generateToolBoundObject(
        provider(config.providerModelId),
        input,
        config.maxOutputTokens,
      ),
  };
}
