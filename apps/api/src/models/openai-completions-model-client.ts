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
  type ChatIdentity,
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
 * Completions only, so it doubles as the client's public `provider` label and
 * as its option namespace when a transport composed over this wire configures
 * no name of its own.
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
  /**
   * Provider name override (design D2): a transport composed over this wire
   * names itself, so the name reaches the adapter factory, is reported as the
   * client's `provider`, and derives the option namespace the operator's
   * record is composed under. Absent means the wire's own name.
   */
  provider?: string;
  /**
   * Fixed transport headers, forwarded to the adapter provider exactly as the
   * Responses client forwards its own (design D2): constant for the client's
   * life, so they ride the provider settings while the per-call headers carry
   * only what changes per request.
   */
  headers?: Record<string, string>;
  /**
   * Fixed transport fetch wrapper — the Go transport's redirect rejection,
   * exactly as the Responses client accepts one for the Codex transport.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Renders one provider header from the request's Chat identity (design D3):
   * the composing module names the header and derives its value from the facts
   * the call site supplied. Merged into the per-call headers of the streaming
   * and the structured request alike; absent means the identity reaches no
   * header at all.
   */
  sessionHeader?: (chat: ChatIdentity) => { name: string; value: string };
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
 * The name this client presents and composes under: the configured provider
 * name for a transport composed over this wire (the Go client's
 * `opencode-go`), the wire's own name otherwise.
 */
function configuredProviderName(
  config: OpenAICompletionsModelClientConfig,
): string {
  return config.provider ?? COMPATIBLE_PROVIDER_NAME;
}

/**
 * The option namespace the adapter derives from a provider name: it
 * camel-cases the name's `-`/`_` boundaries and reads the record under that
 * key (`@ai-sdk/openai-compatible`'s `toCamelCase(providerOptionsName)`), so
 * the operator's options are composed under whatever namespace belongs to the
 * configured name — `openaiCompletions` for this wire's own name,
 * `opencodeGo` for the Go transport's — never a second hardcoded literal.
 */
function providerOptionsNamespace(providerName: string): string {
  return providerName.replaceAll(/[_-]([a-z])/g, (boundary) =>
    boundary.slice(1).toUpperCase(),
  );
}

/**
 * The per-call headers every request this client issues carries (design D6):
 * llame's product token, and the session header its Chat renderer produces
 * when one is configured. Per call rather than provider-level because both
 * are per-request values — the token is replaced by the SDK's own on
 * structured requests, and the session value changes with the Chat — while
 * the client's fixed transport headers ride the provider settings.
 */
function perCallHeaders(
  config: OpenAICompletionsModelClientConfig,
  chat: ChatIdentity,
): Record<string, string> {
  const headers: Record<string, string> = productUserAgentHeaders(config);
  if (config.sessionHeader !== undefined) {
    const { name, value } = config.sessionHeader(chat);
    headers[name] = value;
  }
  return headers;
}

/**
 * One composed record under the configured provider name's namespace — the
 * camel-case the adapter derives from it, not the adapter's own
 * `openaiCompatible` key — for a streaming and a structured-generation
 * request alike. An empty composition contributes nothing, so a request that
 * composes to nothing sends exactly the body it sent before this layer.
 */
function completionsProviderOptions(
  config: OpenAICompletionsModelClientConfig,
  composed: ProviderOptionRecord | undefined,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return composed === undefined
    ? {}
    : {
        providerOptions: {
          [providerOptionsNamespace(configuredProviderName(config))]: composed,
        },
      };
}

function composeCompletionsOptions(
  config: OpenAICompletionsModelClientConfig,
  input: ModelStreamInput,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  // Composed request options (provider-api-selection D5): the operator's
  // object under the run's effort as `reasoningEffort`, no defaults and no
  // invariants on this wire.
  return completionsProviderOptions(
    config,
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
    config,
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
    headers: perCallHeaders(config, input.chat),
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
 * `type: 'openai-completions'` provider entry, at its required `baseUrl` —
 * and, with `provider` configured, the wire a transport composed over it
 * (the Go client) presents itself as.
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
  const providerName = configuredProviderName(config);
  const provider = dependencies.createOpenAICompatible({
    name: providerName,
    baseURL: config.baseUrl,
    // A keyless provider still needs a non-empty apiKey passed through —
    // see KEYLESS_PLACEHOLDER_API_KEY.
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
    ...(config.headers && { headers: config.headers }),
    ...(config.fetch && { fetch: config.fetch }),
  });

  return {
    model: config.modelId,
    provider: providerName,
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined && { pricing: config.pricing }),
    ...(config.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: config.compactionThresholdTokens,
    }),
    streamText: (input: ModelStreamInput) =>
      runOpenAICompatibleStream(provider, config, dependencies, input),
    generateObject: <OBJECT>(input: ModelObjectInput<OBJECT>) =>
      generateToolBoundObject(provider(config.providerModelId), input, {
        headers: perCallHeaders(config, input.chat),
        ...composeStructuredProviderOptions(config),
        ...(config.maxOutputTokens !== undefined && {
          maxOutputTokens: config.maxOutputTokens,
        }),
      }),
  };
}
