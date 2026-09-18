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

function runOpenAICompatibleStream(
  provider: OpenAICompatibleProvider,
  config: OpenAICompletionsModelClientConfig,
  dependencies: OpenAICompletionsModelClientDependencies,
  input: ModelStreamInput,
) {
  const settlement = trackAbortSettlement(input);
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
    // The adapter itself reads `openaiCompatible` — its own non-deprecated
    // key, independent of the provider name configured above — and maps
    // `reasoningEffort` onto the wire's `reasoning_effort`.
    ...(input.effort !== undefined && {
      providerOptions: {
        openaiCompatible: { reasoningEffort: input.effort },
      },
    }),
  };
  applyToolCallingOptions(streamOptions, input);
  // Reasoning is the adapter's own normalized output (design D5): the
  // adapter turns an endpoint's `reasoning_content ?? reasoning` into
  // `reasoning-delta` chunks and re-injects `reasoning_content` outbound, so
  // this client only forwards the normalized delta text — no vendor parser,
  // SSE handling, tag extraction, or middleware.
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
      generateToolBoundObject(provider(config.providerModelId), input),
  };
}
