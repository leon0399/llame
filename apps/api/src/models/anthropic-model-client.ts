import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { APICallError, InvalidArgumentError } from '@ai-sdk/provider';
import {
  generateObject,
  NoOutputGeneratedError,
  streamText,
  type OutputInterface,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import {
  type ModelClient,
  type ModelObjectInput,
  type ModelStreamInput,
} from './model-client';
import type { TokenPrice } from './model-catalog';
import {
  composeProviderOptions,
  type ProviderOptionRecord,
} from './provider-options';
import { consumeReasoningStream } from './reasoning-stream';
import {
  applyToolCallingOptions,
  awaitSettlementAfter,
  KEYLESS_PLACEHOLDER_API_KEY,
  trackAbortSettlement,
} from './openai-model-client';

/**
 * The default Messages endpoint, the `baseURL` the adapter falls back to when
 * the entry configures none. The client always passes a base URL explicitly —
 * this constant or the configured value — so an ambient `ANTHROPIC_BASE_URL`
 * can never move a request off the configured destination
 * (anthropic-provider D3).
 */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

/** The adapter namespace the Messages wire's composed options ride under. */
const MESSAGES_PROVIDER_NAME = 'anthropic-messages';

/**
 * Messages option paths an operator may not set (anthropic-provider D5):
 * server-side execution on another model (`fallbacks`), tools outside llame's
 * gate (`mcpServers`), a provider-side container identifier every owner's
 * requests would share (`container`), and the thinking block binding llame
 * itself owns (`thinking.blockBinding` — an operator value would otherwise
 * reach the adapter as a type-less thinking object on an entry without
 * `reasoning`). Stripped from the operator's record before composition, so no
 * value (including `null`) reaches the request.
 */
const MESSAGES_RESERVED_PROVIDER_OPTION_PATHS: ReadonlyArray<string> = [
  'fallbacks',
  'mcpServers',
  'container',
  'thinking.blockBinding',
];

/**
 * The request-level client defaults (anthropic-provider D7/D11): the
 * provider's default `ephemeral` lifetime on every request, plus adaptive
 * thinking with summarized display whenever the entry declares a `reasoning`
 * vocabulary — the declaration is the switch, mirrored from Claude Code.
 */
const MESSAGES_DEFAULTS: ProviderOptionRecord = {
  cacheControl: { type: 'ephemeral' },
};
const MESSAGES_REASONING_DEFAULTS: ProviderOptionRecord = {
  ...MESSAGES_DEFAULTS,
  thinking: { type: 'adaptive', display: 'summarized' },
};

/**
 * Client-owned options no operator value — `null` included — can remove or
 * replace (D5): the adapter's reasoning-replay switch stays on, and llame's
 * drop-on-prefix-mismatch instruction (D10) rides the adaptive thinking shape
 * only, since that is the only shape the pinned adapter carries it on.
 */
const MESSAGES_INVARIANTS: ProviderOptionRecord = { sendReasoning: true };
const MESSAGES_ADAPTIVE_INVARIANTS: ProviderOptionRecord = {
  ...MESSAGES_INVARIANTS,
  thinking: { blockBinding: { prefixMismatchBehavior: 'drop_block' } },
};

/**
 * `maxRetries: 0` on both AI SDK calls (anthropic-provider D14): a failed
 * request is bounded and settled, never re-attempted — no repeated spend, no
 * credential substitution, and no fallback to another provider or type. The
 * run lifecycle owns any retry decision.
 */
const NO_AUTOMATIC_RETRY = 0;

/**
 * One composed record under this adapter's `anthropic` namespace — the
 * namespace `@ai-sdk/anthropic` reads its own options from — for a streaming
 * and a structured-generation request alike. An empty composition contributes
 * nothing, so a request that composes to nothing sends exactly the body it
 * would have sent before this layer.
 */
function messagesProviderOptions(
  composed: ProviderOptionRecord | undefined,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return composed === undefined
    ? {}
    : { providerOptions: { anthropic: composed } };
}

export type AnthropicModelClientConfig = {
  credential?: string;
  /**
   * The provider callable's explicit `baseURL`: the entry's configured value,
   * or {@link ANTHROPIC_DEFAULT_BASE_URL} when it configures none
   * (anthropic-provider D3). Always present — the factory supplies the
   * default — so the adapter's `ANTHROPIC_BASE_URL` environment fallback never
   * applies.
   */
  baseUrl: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
  /**
   * Operator-authored provider-native options, keyed as the adapter documents
   * them (provider-api-selection): carried by the factory from the model entry
   * and composed at request time rather than sent verbatim — with the run's
   * effort on a streaming request, alone on a structured-generation one. The
   * thinking block binding and the server-side execution keys are stripped
   * before composition.
   */
  providerOptions?: ProviderOptionRecord;
  /**
   * Whether the model entry declares a `reasoning` vocabulary: only then does
   * the client default the adapter's thinking option to adaptive thinking with
   * summarized display (anthropic-provider D11). An entry without one sends no
   * thinking configuration at all, leaving the model's own default in force.
   */
  reasoningDeclared: boolean;
  /** Optional catalog output limit, forwarded as the request's `maxOutputTokens` setting. */
  maxOutputTokens?: number;
};

/**
 * Test seam (anti-slop/no-module-mocking): overrides the AI SDK's
 * provider-factory, streaming entry point, and structured-generation entry
 * point instead of module-mocking `@ai-sdk/anthropic`/`ai`. Production call
 * sites never pass this — the default is the real SDK.
 */
export type AnthropicModelClientDependencies = {
  createAnthropic: typeof createAnthropic;
  streamText: (
    options: Parameters<typeof streamText>[0],
  ) => StreamTextResult<ToolSet, OutputInterface<string, string, never>>;
  generateObject: typeof generateObject;
};

/**
 * The composed thinking object's `type` when it names one. This is the client
 * reading its own composition — never the operator's raw record — because the
 * drop instruction may only ride the adaptive shape the adapter carries it on.
 */
function readThinkingType(
  composed: ProviderOptionRecord | undefined,
): string | undefined {
  const thinking = composed?.['thinking'];
  if (!isRecord(thinking)) return undefined;
  const type = thinking['type'];
  return isString(type) ? type : undefined;
}

/**
 * Removes a `thinking` key that holds an empty record: after the reserved
 * binding is stripped, an operator's binding-only `thinking` object on an
 * entry with no thinking default composes to nothing, and the adapter's
 * thinking union admits no empty shape (it would fail the request explicitly).
 * An empty object carries no instruction, so dropping it is "carries no
 * thinking configuration", not a rewrite.
 */
function dropEmptyThinking(
  composed: ProviderOptionRecord | undefined,
): ProviderOptionRecord | undefined {
  const thinking = composed?.['thinking'];
  if (!isRecord(thinking) || Object.keys(thinking).length > 0) {
    return composed;
  }
  const { thinking: _dropped, ...rest } = composed ?? {};
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/**
 * One request's options, composed under a single precedence
 * (anthropic-provider D5): the client defaults (the cache control on every
 * request, plus adaptive thinking when the entry declares `reasoning`), the
 * operator's object with its reserved paths stripped, the run's resolved
 * effort in the adapter's effort option, and the client's invariants —
 * reason-replay always on, and the drop instruction when the composed thinking
 * object is the adaptive shape. `null` at any depth removes a default and
 * cannot remove an invariant; a value the adapter rejects fails the request
 * explicitly; unknown keys pass through for the adapter to drop or forward.
 *
 * `effort` is the run's resolved token, passed verbatim (no llame vocabulary
 * and no translation); a structured-generation request carries none, so only
 * the operator's own effort key can reach the adapter there.
 */
function composeMessagesOptions(
  config: AnthropicModelClientConfig,
  effort: string | undefined,
): ProviderOptionRecord | undefined {
  const base = composeProviderOptions({
    defaults: config.reasoningDeclared
      ? MESSAGES_REASONING_DEFAULTS
      : MESSAGES_DEFAULTS,
    ...(config.providerOptions !== undefined && {
      operator: config.providerOptions,
    }),
    ...(effort !== undefined && { effort: { effort } }),
    reservedPaths: MESSAGES_RESERVED_PROVIDER_OPTION_PATHS,
  });
  return dropEmptyThinking(
    composeProviderOptions({
      ...(base !== undefined && { operator: base }),
      invariants:
        readThinkingType(base) === 'adaptive'
          ? MESSAGES_ADAPTIVE_INVARIANTS
          : MESSAGES_INVARIANTS,
    }),
  );
}

/** The HTTP status an SDK error carries, when it carries one directly. */
function directHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const statusCode = error['statusCode'];
  return isNumber(statusCode) ? statusCode : undefined;
}

/**
 * The abort-shaped error names `@ai-sdk/provider-utils` itself classifies as
 * an aborted request (`isAbortError`): the stream result's `text` and
 * `consumeStream` reject with the abort signal's own reason, so a consumer
 * that recognizes a rejection as an abort keeps doing so. The reason is
 * llame's own — a `DOMException`, `AbortSignal.timeout()`'s `TimeoutError`,
 * Next.js's `ResponseAborted` — never bytes from a provider, so the identity
 * discloses nothing upstream.
 */
const ABORT_ERROR_NAMES: ReadonlyArray<string> = [
  'AbortError',
  'TimeoutError',
  'ResponseAborted',
];

/**
 * Whether `error` is a failure llame, the adapter, or the AI SDK authored
 * locally, whose message cannot have come from an upstream payload — the only
 * status-less failures that may keep their own diagnostic:
 *
 * - `InvalidArgumentError`: the adapter's option-value rejection, raised
 *   before any request (e.g. an invalid `effort`) — the actionable operator
 *   diagnostic the run keeps (D14).
 * - `NoOutputGeneratedError`: the AI SDK's own marker for a result that ended
 *   without output — how a response that parses to no Messages event at all
 *   surfaces. The SDK builds its fixed text ("No output generated…") itself,
 *   never from response bytes, and it is the marker every wire's client
 *   surfaces on the result's `text` channel.
 * - an abort-shaped rejection: see {@link ABORT_ERROR_NAMES}.
 *
 * Everything else status-less — a transport failure, a malformed (or
 * truncated) event arriving after the stream started, a rejection nothing
 * recognizes — carries upstream or endpoint text in its message, its cause,
 * or its own payload (the malformed event's `JSONParseError` spells the raw
 * event data out in `.text` as well as its message), and is bounded by the
 * caller.
 */
function isLocalFailure(error: unknown): error is Error {
  return (
    InvalidArgumentError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    (error instanceof Error && ABORT_ERROR_NAMES.includes(error.name))
  );
}

/**
 * Replaces a provider failure with a bounded message before it enters the run
 * lifecycle (anthropic-provider D14): the endpoint's error body can echo
 * request details, so no upstream text is forwarded — only the class of
 * failure. A failure carrying an HTTP status maps by that status.
 *
 * A status-less failure is bounded too: a transport failure, a malformed (or
 * truncated) event arriving after the stream started, and a rejection nothing
 * recognizes all carry upstream or endpoint text in their message, their
 * cause, or their own payload — a transport `APICallError` even holds the
 * values of the request llame sent. Only the failures {@link isLocalFailure}
 * recognizes pass through unchanged, because llame, the adapter, or the AI
 * SDK authored their text.
 */
function sanitizeAnthropicError(error: unknown): Error {
  const statusCode = directHttpStatus(error);
  if (statusCode === undefined) {
    if (isLocalFailure(error)) return error;
    // A status-less `APICallError` is the SDK's transport wrapper: its message
    // names the underlying cause ("Cannot connect to API: …") and its
    // `requestBodyValues` holds the request — neither may be forwarded.
    return new Error(
      APICallError.isInstance(error)
        ? 'Anthropic request failed: the endpoint could not be reached.'
        : 'Anthropic request failed.',
    );
  }
  if (statusCode === 401) {
    return new Error(
      'Anthropic authentication failed: the configured credential was rejected.',
    );
  }
  if (statusCode === 404) {
    return new Error('Anthropic request failed: unknown model or endpoint.');
  }
  if (statusCode === 429) {
    return new Error('Anthropic rate limit reached. Retry manually later.');
  }
  if (statusCode === 400) {
    return new Error(
      'Anthropic request rejected: invalid model or request option.',
    );
  }
  return new Error('Anthropic request failed.');
}

/**
 * Builds one streaming request: the declared Messages wire (anthropic-provider
 * D1), the caller's message/system/abort plumbing, the composed options, the
 * catalog output limit, and the shared tool loop. Text deltas ride `onChunk`;
 * the whole reasoning channel — deltas, part metadata, and the
 * provider-invocation-scoped part ids — comes off one `fullStream` branch in
 * `runAnthropicStream` through the shared helper.
 */
function buildStreamOptions(
  provider: AnthropicProvider,
  config: AnthropicModelClientConfig,
  input: ModelStreamInput,
  onError: ModelStreamInput['onError'],
): Parameters<typeof streamText>[0] {
  const streamOptions: Parameters<typeof streamText>[0] = {
    model: provider(config.providerModelId),
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    onError,
    maxRetries: NO_AUTOMATIC_RETRY,
    ...messagesProviderOptions(composeMessagesOptions(config, input.effort)),
    ...(config.maxOutputTokens !== undefined && {
      maxOutputTokens: config.maxOutputTokens,
    }),
  };
  applyToolCallingOptions(streamOptions, input);
  if (input.onTextDelta) {
    streamOptions.onChunk = ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        input.onTextDelta?.(chunk.text);
      }
    };
  }
  return streamOptions;
}

function runAnthropicStream(
  provider: AnthropicProvider,
  config: AnthropicModelClientConfig,
  dependencies: AnthropicModelClientDependencies,
  input: ModelStreamInput,
) {
  const onError = input.onError;
  const settlement = trackAbortSettlement(input);
  const streamOptions = buildStreamOptions(
    provider,
    config,
    input,
    onError === undefined
      ? undefined
      : ({ error }: { error: unknown }) =>
          onError({ error: sanitizeAnthropicError(error) }),
  );
  streamOptions.onAbort = settlement.onAbort;
  streamOptions.onFinish = input.onFinish;
  const result = dependencies.streamText(streamOptions);
  if (input.onReasoningDelta) {
    void consumeReasoningStream(result.fullStream, input.onReasoningDelta);
  }
  return awaitSettlementAfter(result, settlement, sanitizeAnthropicError);
}

/**
 * Schema-constrained single object generation through the AI SDK's JSON
 * response format (anthropic-provider D12): llame authors no tool choice — the
 * adapter selects the provider's mechanism itself (the native output format on
 * models its capability table supports, its own JSON tool otherwise). A
 * generation the provider rejects fails explicitly and the caller's plain-text
 * fallback runs; the composed options are the same client defaults and
 * operator record the streaming path sends, minus the run's effort, which
 * `ModelObjectInput` does not carry.
 */
async function runAnthropicObject<OBJECT>(
  provider: AnthropicProvider,
  config: AnthropicModelClientConfig,
  dependencies: AnthropicModelClientDependencies,
  input: ModelObjectInput<OBJECT>,
): Promise<OBJECT> {
  const result = await dependencies
    .generateObject({
      model: provider(config.providerModelId),
      output: 'object',
      schema: input.schema,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      maxRetries: NO_AUTOMATIC_RETRY,
      ...(input.schemaName !== undefined && { schemaName: input.schemaName }),
      ...(input.schemaDescription !== undefined && {
        schemaDescription: input.schemaDescription,
      }),
      ...messagesProviderOptions(composeMessagesOptions(config, undefined)),
      ...(config.maxOutputTokens !== undefined && {
        maxOutputTokens: config.maxOutputTokens,
      }),
    })
    .catch((error: unknown) => {
      throw sanitizeAnthropicError(error);
    });
  return result.object;
}

/**
 * Creates a model client that executes the Messages wire for an
 * `anthropic-messages` provider entry — at the Anthropic API when the entry
 * configures no `baseUrl`, or at any Messages-speaking gateway exactly as
 * authored. The wire is fixed by construction, never inferred from the entry's
 * id or host; dispatch follows `type` alone (anthropic-provider D1).
 *
 * `modelId` is the opaque llame id used for telemetry and API events.
 * `providerModelId` is the server-only model id sent to the provider.
 * @returns A model client that streams text using the configured model
 */
export function createAnthropicModelClient(
  config: AnthropicModelClientConfig,
  dependencies: AnthropicModelClientDependencies = {
    createAnthropic,
    streamText,
    generateObject,
  },
): ModelClient {
  const provider = dependencies.createAnthropic({
    // A keyless provider (empty/absent credential) still needs a non-empty
    // apiKey passed through — see KEYLESS_PLACEHOLDER_API_KEY. Sent as the
    // `x-api-key` header, exactly like a real credential (D3).
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
    // Always explicit, so an ambient ANTHROPIC_BASE_URL can never retarget the
    // request (D3): the factory supplies the configured value or the default.
    baseURL: config.baseUrl,
  });

  return {
    model: config.modelId,
    provider: MESSAGES_PROVIDER_NAME,
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined && { pricing: config.pricing }),
    ...(config.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: config.compactionThresholdTokens,
    }),
    streamText: (input: ModelStreamInput) =>
      runAnthropicStream(provider, config, dependencies, input),
    generateObject: <OBJECT>(input: ModelObjectInput<OBJECT>) =>
      runAnthropicObject(provider, config, dependencies, input),
  };
}
