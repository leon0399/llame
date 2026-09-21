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
  productUserAgentHeaders,
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
  /**
   * llame's product token and version (`llame/<version>`), read once at boot
   * under the instance-configuration contract (design D6) and sent as the
   * lowercase `user-agent` on the PER-CALL headers of every language-model
   * request this client issues — streaming and structured generation alike.
   * Per-call rather than provider-level: the AI SDK replaces a
   * provider-level `User-Agent` with its own token on structured requests.
   */
  userAgent: string;
  /** Required: the compatible adapter has no default endpoint. */
  baseUrl: string;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
  /**
   * Operator-authored provider-native options, keyed as the adapter
   * documents them (provider-api-selection): carried by the factory from
   * the model entry and composed at request time rather than sent verbatim —
   * with the run's effort on a streaming request, alone on a
   * structured-generation one.
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

/**
 * Chat Completions option paths an operator may not set (design D5): the
 * adapter spreads unknown keys over them into the request body, so any of
 * them would retarget the request — the wire's model identifier, its own raw
 * output-limit field, and its tool choice. `max_tokens` in particular stays
 * the catalog output limit's seat (D17), never an option's. Stripped from the
 * operator's record before composition, so no value (including `null`)
 * reaches the request.
 */
const COMPLETIONS_RESERVED_PROVIDER_OPTION_PATHS: ReadonlyArray<string> = [
  'model',
  'max_tokens',
  'tool_choice',
];

/**
 * One composed record under this adapter's `openaiCompletions` namespace —
 * the camel-case of the provider name configured above, not the adapter's own
 * `openaiCompatible` key — for a streaming and a structured-generation
 * request alike. An empty composition contributes nothing, so a request that
 * composes to nothing sends exactly the body it sent before this layer.
 */
function completionsProviderOptions(
  composed: ProviderOptionRecord | undefined,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return composed === undefined
    ? {}
    : { providerOptions: { openaiCompletions: composed } };
}

function composeCompletionsOptions(
  config: OpenAICompletionsModelClientConfig,
  input: ModelStreamInput,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  // Composed request options (provider-api-selection D5): the operator's
  // object under the run's effort as `reasoningEffort`, no defaults and no
  // invariants on this wire.
  return completionsProviderOptions(
    composeProviderOptions({
      operator: config.providerOptions,
      ...(input.effort !== undefined && {
        effort: { reasoningEffort: input.effort },
      }),
      reservedPaths: COMPLETIONS_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  );
}

/**
 * The structured-generation path's options: the same operator record and
 * reserved stripping as streaming, and nothing else — `ModelObjectInput`
 * carries no effort, and this wire defaults no option and pins no invariant
 * (provider-api-selection: the entry's options reach every language-model
 * request). Composes to nothing for an entry that configures no options,
 * which leaves this path's option-free request exactly as it was.
 */
function composeStructuredProviderOptions(
  config: OpenAICompletionsModelClientConfig,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return completionsProviderOptions(
    composeProviderOptions({
      operator: config.providerOptions,
      reservedPaths: COMPLETIONS_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  );
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
    // llame's identity rides every request (design D6), per call: the
    // provider-level headers cannot carry it on structured requests.
    headers: productUserAgentHeaders(config),
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
      generateToolBoundObject(provider(config.providerModelId), input, {
        headers: productUserAgentHeaders(config),
        ...composeStructuredProviderOptions(config),
        ...(config.maxOutputTokens !== undefined && {
          maxOutputTokens: config.maxOutputTokens,
        }),
      }),
  };
}
