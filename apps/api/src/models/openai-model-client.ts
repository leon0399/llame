import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { streamText, type ToolSet } from 'ai';
import { classifyResponses } from './provider-failure/classify-responses';
import {
  captureRequestFailure,
  classifiedFailure,
  promiseFailureOverrides,
  type ProviderFailureMiddlewareOptions,
} from './provider-failure-middleware';
import { applyRequestRecovery, withRequestRecovery } from './request-recovery';

import {
  agentTelemetry,
  type BillingMode,
  type ChatIdentity,
  createModelStreamFinishCallback,
  type ModelClient,
  type ModelFailureSanitizer,
  type ModelObjectInput,
  type ModelStreamInput,
  type ModelStreamResult,
} from './model-client';
import { generateToolBoundObject } from './model-object-generation';
import {
  withRequestHeaders,
  type RequestHeaderTemplates,
  type RequestHeaders,
} from './request-headers';
import { applyRequestUsageCallback } from './request-usage';
import type { ModelInput, TokenPrice } from './model-catalog';
import { installStepPreparation, toolLoopStopWhen } from './step-composer';
import {
  composeProviderOptions,
  type ProviderOptionRecord,
} from './provider-options';
import { consumeStreamParts } from './stream-parts';
import {
  createToolCallGate,
  gateToolExecution,
  refuseUnavailableToolCalls,
  type ToolCallGate,
} from './tool-call-gate';
import { wrapStreamTextResult } from './stream-text-result-proxy';

/**
 * Non-empty placeholder credential for a keyless provider (#162): a genuinely
 * keyless OpenAI-compatible endpoint (e.g. local Ollama with no auth) never
 * inspects this value, but `@ai-sdk/provider-utils`'s `loadApiKey` throws
 * `LoadAPIKeyError` when `apiKey` is omitted entirely and no `OPENAI_API_KEY`
 * is set in the process environment — omitting `apiKey` is therefore NOT the
 * same as "no credential required". A hosted endpoint that actually needs
 * auth still fails, just at request time (401) instead of at construction,
 * which matches the existing "provider credential validity is not
 * prevalidated" contract.
 */
export const KEYLESS_PLACEHOLDER_API_KEY = 'keyless-no-credential-configured';

/**
 * The per-call `headers` every language-model request carries: llame's product
 * token as the lowercase `user-agent` (design D6). Every wire's client sends
 * these on each `streamText`/`generateText`/`generateObject` call rather than
 * on its provider-level headers, because the AI SDK replaces a provider-level
 * `User-Agent` with its own `ai/<version>` on structured requests; the key is
 * lowercase so it replaces the adapter's own header instead of duplicating it.
 * Single-sourced here so no client can drift on the key or the value.
 */
export function productUserAgentHeaders(config: {
  userAgent: string;
}): RequestHeaders {
  return { 'user-agent': config.userAgent };
}

function disableStrictToolSchemas(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      definition.type === 'provider'
        ? definition
        : { ...definition, strict: false },
    ]),
  );
}

/** Builds the provider-failure classifier and bounded sanitizer for one call. */
function providerFailureOptions(
  config: OpenAIModelClientConfig,
  abortSignal?: AbortSignal,
): ProviderFailureMiddlewareOptions {
  return {
    provider: config.providerType ?? config.provider ?? 'openai',
    classify: classifyResponses,
    sanitize: config.sanitizeError,
    abortSignal,
  };
}

function streamSanitizer(
  config: OpenAIModelClientConfig,
  abortSignal?: AbortSignal,
): ModelFailureSanitizer {
  const options = providerFailureOptions(config, abortSignal);

  return (error) => classifiedFailure(error, options);
}

/**
 * Tool-calling loop: the SDK auto-executes tools and re-calls the model.
 * Only wired when tools are present — an answer-only turn keeps the single-
 * generation path unchanged. Mutates `streamOptions` in place, matching the
 * incremental build-up style the rest of `streamText` already uses. Shared
 * by every wire's client (exported for `openai-completions-model-client`),
 * so refusal reporting stays single-sourced. The step cap and `onStepStart`
 * live in `installStepPreparation`, which every client installs with or
 * without tools. `gate` orders execution and refusal reports behind the
 * stream channel; a client with an in-order consumer attaches it through
 * `bindStreamChannel`, and an unattached gate lets calls run as they arrive.
 */
export function applyToolCallingOptions(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
  gate: ToolCallGate,
): void {
  if (!input.tools) return;

  // Always set strict: false — Responses may rewrite omitted strict into
  // required-nullable optionals; Chat Completions ignores the flag.
  streamOptions.tools = gateToolExecution(
    disableStrictToolSchemas(input.tools),
    gate,
  );
  input.onToolSet?.(streamOptions.tools);

  if (input.toolChoice !== undefined) {
    streamOptions.toolChoice = input.toolChoice;
  }

  // The SDK keeps every step's request body in `recordedSteps` for the whole
  // call by default, and an uncapped call can run for hours (design D1).
  streamOptions.experimental_include = { requestBody: false };
  streamOptions.stopWhen = toolLoopStopWhen(input);
  streamOptions.experimental_repairToolCall = refuseUnavailableToolCalls(
    input.onUnavailableToolCall,
    gate,
  );
}

export interface AbortSettlement {
  /** Bind directly to `streamText`'s `onAbort` handler. */
  onAbort: () => void;
  /** Await after the SDK result settles; rethrows a failed abort-time `onError`. */
  wait: () => Promise<void>;
}

type TerminalCallbackOptions = Pick<
  Parameters<typeof streamText>[0],
  'onError' | 'onFinish'
>;

/** Terminal work ordered behind one request's reasoning stream. */
export interface DeferredTerminals {
  defer: (task: () => void | PromiseLike<void>) => void;
  bind: (consumption: Promise<void>) => void;
  /** Waits for queued work and surfaces its first failure. */
  wait: () => Promise<void>;
}

function createDeferredTerminals(): DeferredTerminals {
  let gate = Promise.resolve();
  let chain = Promise.resolve();
  let failure: { error: unknown } | undefined;

  const drain = async (): Promise<void> => {
    await gate;
    await chain;
  };

  return {
    defer: (task) => {
      chain = chain.then(async () => {
        await gate;

        try {
          await task();
        } catch (error) {
          failure ??= { error };
        }
      });
    },
    bind: (consumption) => {
      gate = consumption;
    },
    wait: async () => {
      await drain();

      if (failure !== undefined) throw failure.error;
    },
  };
}

/**
 * Whether this request needs the shared `fullStream` consumer: any of the text,
 * reasoning, or tool-call metadata seams is in use. The consumer owns the
 * tool-call gate, so a request without one of these callbacks leaves the gate
 * unattached and its calls run as they arrive.
 */
export function hasStreamChannel(input: ModelStreamInput): boolean {
  return (
    input.onTextDelta !== undefined ||
    input.onReasoningDelta !== undefined ||
    input.onToolCallMetadata !== undefined ||
    input.onToolCall !== undefined
  );
}

/**
 * Queues the SDK's terminal callbacks instead of awaiting them inside its
 * pipeline, which would deadlock the `fullStream` branch they must follow.
 * The client binds the returned queue to its single stream consumer after
 * `streamText` returns.
 */
export function deferTerminalCallbacks(
  streamOptions: TerminalCallbackOptions,
): DeferredTerminals {
  const terminals = createDeferredTerminals();

  const onFinish = streamOptions.onFinish;

  if (onFinish !== undefined) {
    streamOptions.onFinish = (event) => {
      terminals.defer(() => onFinish(event));
    };
  }

  const onError = streamOptions.onError;

  if (onError !== undefined) {
    streamOptions.onError = (event) => {
      terminals.defer(() => onError(event));
    };
  }

  return terminals;
}

/** Binds the queue and the tool-call gate to the request's one stream
 *  consumer. */
export function bindStreamChannel(
  terminals: DeferredTerminals,
  result: Pick<ModelStreamResult, 'fullStream'>,
  input: ModelStreamInput,
  gate: ToolCallGate,
): void {
  if (!hasStreamChannel(input)) return;
  gate.attach();
  terminals.bind(consumeStreamParts(result.fullStream, input, gate));
}

/**
 * Tracks the async settlement of the `onError` call `streamText` fires when
 * `abortSignal` triggers (the AI SDK invokes `onAbort` without awaiting its
 * return value), so callers can await it — and surface its rejection — after
 * the stream itself has settled, rather than observing a drained result
 * before the run's terminal state is persisted.
 *
 * The abort's error call rides `terminals`, behind the reasoning channel's
 * consumer, so the run's abort persistence observes every delivery the channel
 * already made. The error stays the signal's own reason — never the request's
 * sanitizing `onError`, and never a provider failure.
 */
export function trackAbortSettlement(
  input: ModelStreamInput,
  terminals: DeferredTerminals = createDeferredTerminals(),
): AbortSettlement {
  let settlement = Promise.resolve();
  let settlementError: { error: unknown } | undefined;

  return {
    onAbort: () => {
      terminals.defer(() =>
        input.onError?.({
          error:
            input.abortSignal?.reason ??
            new DOMException('Aborted', 'AbortError'),
        }),
      );
      settlement = terminals.wait().catch((error: unknown) => {
        settlementError = { error };
      });
    },
    wait: async () => {
      await settlement;

      if (settlementError) {
        throw settlementError.error;
      }
    },
  };
}

async function throwAfterTerminalCompletion(
  terminals: DeferredTerminals,
  error: unknown,
  sanitizeError?: ModelFailureSanitizer,
): Promise<never> {
  await terminals.wait();
  throw sanitizeError?.(error) ?? error;
}

async function awaitTextAfterSettlement(
  text: PromiseLike<string>,
  settlement: AbortSettlement,
  terminals: DeferredTerminals,
  sanitizeError?: ModelFailureSanitizer,
): Promise<string> {
  let value: string;

  try {
    value = await text;
    await settlement.wait();
  } catch (error) {
    try {
      await settlement.wait();
    } catch (settlementError) {
      await terminals.wait();
      throw settlementError;
    }

    return throwAfterTerminalCompletion(terminals, error, sanitizeError);
  }

  await terminals.wait();

  return value;
}

/**
 * Makes `result`'s `consumeStream`/`text` also await the abort settlement and
 * the terminal callbacks `terminals` defers behind the reasoning channel's
 * consumer (design D18).
 *
 * The channel's consumer reads its own branch of the same stream, and the SDK
 * does not order that branch against this settlement: its last deliveries are
 * still queued when the stream settles, so a caller that reads back what the
 * channel delivered (the run's persistence points) would race them. Awaiting
 * the deferred callbacks HERE is safe precisely because the SDK's own
 * settlement has resolved first — the callbacks run from the pipeline the
 * stream's branches close behind, so ordering them on the consumer's completion
 * *inside* the stream would deadlock it.
 *
 * A failed stream settlement waits for terminal persistence first. A terminal
 * failure takes precedence, matching the SDK's callback semantics; otherwise
 * the stream's own error surfaces unchanged. A deferred callback's failure is
 * the run's, never a provider's, so it is not provider-sanitized.
 */
export function awaitSettlementAfter(
  result: ModelStreamResult,
  settlement: AbortSettlement,
  sanitizeError?: ModelFailureSanitizer,
  terminals: DeferredTerminals = createDeferredTerminals(),
): ModelStreamResult {
  // These channels can reject before deferred onError capture runs. Normalize
  // at their rejection boundary; awaiting terminals here can deadlock the
  // stream consumer that releases those callbacks.
  return wrapStreamTextResult(result, {
    ...promiseFailureOverrides(sanitizeError),
    consumeStream: (target) => ({
      value: async (...args: Parameters<typeof target.consumeStream>) => {
        try {
          await target.consumeStream(...args);
        } catch (error) {
          await settlement.wait();
          await throwAfterTerminalCompletion(terminals, error, sanitizeError);
        }

        await settlement.wait();
        await terminals.wait();
      },
    }),
    text: (target) => ({
      value: awaitTextAfterSettlement(
        target.text,
        settlement,
        terminals,
        sanitizeError,
      ),
    }),
  });
}

/** The AI SDK streaming request a client composes. */
type StreamOptions = Parameters<typeof streamText>[0];

/**
 * Runs one prepared stream request through the production channel: the
 * terminal callbacks and the abort settlement queue behind the request's one
 * `fullStream` consumer, and the returned result awaits both. `streamOptions`
 * already carries the gate's tool options and the step preparation.
 */
export function runStreamChannel(run: {
  streamOptions: StreamOptions & { model: LanguageModelV3 };
  input: ModelStreamInput;
  gate: ToolCallGate;
  runStreamText: (options: StreamOptions) => ModelStreamResult;
  sanitizeError?: ModelFailureSanitizer;
}): ModelStreamResult {
  const { streamOptions, input, gate, runStreamText, sanitizeError } = run;
  // SDK callbacks return immediately so the `fullStream` stream branch can
  // close; the run's callbacks and abort persistence then execute in order
  // behind that branch (D15/D18).
  const terminals = deferTerminalCallbacks(streamOptions);

  const requestSanitizer = captureRequestFailure(
    streamOptions,
    sanitizeError,
    input.onSendFailed,
  );

  const settlement = trackAbortSettlement(input, terminals);
  streamOptions.onAbort = settlement.onAbort;
  const result = runStreamText(streamOptions);
  bindStreamChannel(terminals, result, input, gate);

  return awaitSettlementAfter(result, settlement, requestSanitizer, terminals);
}

export type OpenAIModelClientConfig = {
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
  /** Startup-resolved operator header templates rendered for every request. */
  requestHeaders: RequestHeaderTemplates;
  baseUrl?: string;
  /** Fixed-provider transport headers. */
  headers?: Record<string, string>;
  /** Fixed-provider transport fetch wrapper. */
  fetch?: typeof globalThis.fetch;
  /** Omit structured-object generation when the transport does not support it. */
  generateObject?: boolean;
  /**
   * Operator request options (`models[].providerOptions`), the free-form
   * inner record as written in config — this client wraps it under the
   * Responses wire's `openai` namespace and strips the wire's reserved paths
   * (design D5) on every request it issues, streaming and structured
   * generation alike. Streaming composes it under the fixed precedence:
   * client defaults < operator < run effort < client invariants, with `null`
   * at any depth removing a defaulted key; a structured request carries the
   * operator layer and the wire's invariants (no default, no effort).
   */
  providerOptions?: ProviderOptionRecord;
  /**
   * Client-owned options no operator value — `null` included — can remove or
   * replace (design D5). The codex subscription transport pins
   * `reasoningSummary: 'auto'` here; `store: false` is the Responses wire's
   * own invariant, applied after this record to every request of either
   * client (design D12). A configured record can add to those invariants but
   * never remove them.
   */
  providerOptionInvariants?: ProviderOptionRecord;
  /**
   * Catalog `models[].maxOutputTokens` (design D17), forwarded as the AI
   * SDK's `maxOutputTokens` setting on every request this client issues —
   * streaming (compaction included) and structured generation alike. It is a
   * call setting, not a namespaced provider option, so an operator cannot
   * reach it through `providerOptions`. Absent leaves the adapter's own
   * default in force.
   */
  maxOutputTokens?: number;
  /** Public provider identifier exposed by this client. */
  provider?: string;
  /** Original provider type, preserved when a wire adapter is selected. */
  providerType?: string;
  /** Replaces provider errors before they enter the run lifecycle. */
  sanitizeError?: (error: unknown) => Error;
  pricing?: TokenPrice;
  billing?: BillingMode;
  compactionThresholdTokens?: number;
  firstTokenTimeoutSeconds?: number;
  /** Catalog `models[].input`; absent means `['text']`. */
  input?: ReadonlyArray<ModelInput>;
  /**
   * The entry's `models[].reasoning` declaration — presence of the vocabulary
   * is the declaration, as on the Messages client. A declared entry forces the
   * adapter's reasoning treatment (`forceReasoning: true`), so an id the
   * adapter does not recognize still asks for `reasoning.encrypted_content`
   * (design D12). Absent or false leaves the adapter's own id rule in force.
   */
  reasoningDeclared?: boolean;
};

/**
 * Test seam (anti-slop/no-module-mocking): overrides the AI SDK's
 * provider-factory and streaming entry points instead of module-mocking
 * `@ai-sdk/openai`/`ai`. Production call sites never pass this — the default
 * is the real SDK.
 */
export type OpenAIModelClientDependencies = {
  createOpenAI: typeof createOpenAI;
  streamText: (options: Parameters<typeof streamText>[0]) => ModelStreamResult;
};

/**
 * Responses-wire option paths an operator may not set (design D5): both
 * provider-side continuation keys would let one Chat resume another owner's
 * server-side state, `instructions` replaces llame's prompt, a
 * `systemMessageMode` of `remove` strips it with only a warning, and
 * `allowedTools` overrides the request's tool choice — the forced choice
 * structured generation relies on. Stripped from the operator's record
 * before composition, so no value (including `null`) reaches the request.
 */
const RESPONSES_RESERVED_PROVIDER_OPTION_PATHS: ReadonlyArray<string> = [
  'conversation',
  'previousResponseId',
  'instructions',
  'systemMessageMode',
  'allowedTools',
];

/**
 * The per-client pieces every request reuses, so they are built once when the
 * client is created: the config never changes afterwards, and the invariants
 * are derived from it.
 */
type ResponsesClientContext = {
  openai: OpenAIProvider;
  config: OpenAIModelClientConfig;
  invariants: ProviderOptionRecord;
};

/**
 * One composed record under the Responses wire's `openai` namespace — the
 * namespace `@ai-sdk/openai` reads its own options from, for a streaming and a
 * structured-generation request alike. This wire always contributes at least
 * `store: false`, so the empty composition the composer's type admits never
 * arises here.
 */
function responsesProviderOptions(
  composed: ProviderOptionRecord | undefined,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return { providerOptions: { openai: composed ?? {} } };
}

/**
 * The invariants of one Responses request, applied as the composer's last
 * layer. `store: false` (design D12) means the provider keeps no response for
 * later retrieval through the API, so no request depends on a stored item
 * that could expire or belong to another Chat; the provider's own retention
 * policy is unchanged, and an endpoint at another `baseUrl` follows its own.
 * The transport's configured record (the Codex client's) comes first, then
 * this wire's key. A declared-reasoning entry also forces the adapter's
 * reasoning treatment, so an id the adapter does not recognize still asks for
 * `reasoning.encrypted_content`. Client-owned like any invariant: no operator
 * value, `null` included, can remove or replace one. An entry that declares no
 * reasoning sends no `forceReasoning`, so the adapter's model-id rule stays in
 * force for it. `config` never changes after the client is created, so this is
 * computed once per client.
 */
function responsesInvariants(
  config: OpenAIModelClientConfig,
): ProviderOptionRecord {
  return {
    ...config.providerOptionInvariants,
    store: false,
    ...(config.reasoningDeclared === true && { forceReasoning: true }),
  };
}

/**
 * Builds the per-call headers shared by streaming and structured requests.
 */
function perCallHeaders(config: OpenAIModelClientConfig, chat: ChatIdentity) {
  return withRequestHeaders(
    productUserAgentHeaders(config),
    config.requestHeaders,
    chat,
  );
}

/**
 * Attaches the rendered operator request headers and this wire's provider
 * options, composed from four layers under one precedence (design D5): this
 * wire's per-request-kind default (the displayable reasoning summary, which
 * the structured-generation path does not take — see
 * `composeStructuredProviderOptions`), the operator's object, the run's
 * effort, and the client's invariants — each layer replaces or removes what
 * the earlier ones set, never the other way around. The operator's reserved
 * paths are stripped by the composer.
 *
 * Every Responses request carries at least the wire's own `store: false`
 * invariant (design D12), so the composed record is never empty.
 * `!== undefined` rather than truthiness for the effort — a level meaning "no
 * reasoning" is an instruction to send, not an absence.
 */
function applyRequestOptions(
  streamOptions: Parameters<typeof streamText>[0],
  config: OpenAIModelClientConfig,
  input: ModelStreamInput,
  invariants: ProviderOptionRecord,
): void {
  streamOptions.headers = perCallHeaders(config, input.chat);
  streamOptions.experimental_telemetry = agentTelemetry(input.chat);
  streamOptions.providerOptions = responsesProviderOptions(
    composeProviderOptions({
      defaults: { reasoningSummary: 'auto' },
      ...(config.providerOptions !== undefined && {
        operator: config.providerOptions,
      }),
      ...(input.effort !== undefined && {
        effort: { reasoningEffort: input.effort },
      }),
      invariants,
      reservedPaths: RESPONSES_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  ).providerOptions;
}

/**
 * The structured-generation path's options: the operator's
 * `models[].providerOptions` under this wire's namespace with its reserved
 * paths stripped, and the wire's invariants (provider-api-selection: the
 * entry's options, and `store: false`, reach every language-model request on
 * this wire — design D12). The displayable reasoning summary is a streaming
 * default and is not added here; `ModelObjectInput` carries no effort, so
 * there is no run layer. A declared-reasoning entry forces the adapter's
 * reasoning treatment here too, which asks for encrypted reasoning content
 * without adding a reasoning summary the path never sent.
 */
function composeStructuredProviderOptions(
  context: ResponsesClientContext,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  const { config, invariants } = context;

  return responsesProviderOptions(
    composeProviderOptions({
      ...(config.providerOptions !== undefined && {
        operator: config.providerOptions,
      }),
      invariants,
      reservedPaths: RESPONSES_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  );
}

/**
 * Builds the Responses request. Text, reasoning, and tool-call metadata all
 * ride ONE consumer of the result's `fullStream` (`consumeStreamParts`):
 * `onChunk` never sees a text part's start or end, so it cannot carry the item
 * id a Responses `message` part is replayed with (design A7), and a single
 * consumer keeps part boundaries, metadata binding, and their order in one
 * place (design D18).
 */
function buildOpenAIStreamOptions(
  context: ResponsesClientContext,
  input: ModelStreamInput,
  gate: ToolCallGate,
): Parameters<typeof streamText>[0] & { model: LanguageModelV3 } {
  const { openai, config, invariants } = context;
  const sanitize = streamSanitizer(config, input.abortSignal);

  const streamOptions: Parameters<typeof streamText>[0] & {
    model: LanguageModelV3;
  } = {
    model: openai(config.providerModelId),
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    onError: ({ error }) => input.onError?.({ error: sanitize(error) }),
    onFinish: createModelStreamFinishCallback(input.onFinish),
    maxOutputTokens: config.maxOutputTokens,
    maxRetries: 0,
  };

  applyRequestOptions(streamOptions, config, input, invariants);
  applyToolCallingOptions(streamOptions, input, gate);
  installStepPreparation(streamOptions, input, config);
  applyRequestRecovery(streamOptions, input, {
    ...providerFailureOptions(config, input.abortSignal),
    firstTokenTimeoutSeconds: config.firstTokenTimeoutSeconds,
  });
  applyRequestUsageCallback(streamOptions, input);

  return streamOptions;
}

function runOpenAIStream(
  context: ResponsesClientContext,
  dependencies: OpenAIModelClientDependencies,
  input: ModelStreamInput,
): ModelStreamResult {
  const gate = createToolCallGate();
  const streamOptions = buildOpenAIStreamOptions(context, input, gate);

  return runStreamChannel({
    streamOptions,
    input,
    gate,
    runStreamText: dependencies.streamText,
    sanitizeError: streamSanitizer(context.config, input.abortSignal),
  });
}

/**
 * Creates the provider and the per-client request context once: the config
 * never changes afterwards and the invariants derive from it.
 */
function createResponsesClientContext(
  config: OpenAIModelClientConfig,
  dependencies: OpenAIModelClientDependencies,
): ResponsesClientContext {
  return {
    config,
    invariants: responsesInvariants(config),
    openai: dependencies.createOpenAI({
      // A keyless provider (empty/absent credential) still needs a non-empty
      // apiKey passed through — see KEYLESS_PLACEHOLDER_API_KEY.
      apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
      ...(config.headers && { headers: config.headers }),
      ...(config.fetch && { fetch: config.fetch }),
    }),
  };
}

function createStructuredObjectGenerator(context: ResponsesClientContext) {
  const { config } = context;

  return async <OBJECT>(input: ModelObjectInput<OBJECT>) => {
    try {
      return await generateToolBoundObject(
        withRequestRecovery(context.openai(config.providerModelId), {
          ...providerFailureOptions(config, input.abortSignal),
          firstTokenTimeoutSeconds: config.firstTokenTimeoutSeconds,
          bufferWholeSend: true,
        }),
        input,
        {
          headers: perCallHeaders(config, input.chat),
          ...composeStructuredProviderOptions(context),
          maxOutputTokens: config.maxOutputTokens,
        },
      );
    } catch (error) {
      throw classifiedFailure(
        error,
        providerFailureOptions(config, input.abortSignal),
      );
    }
  };
}

/**
 * Creates a model client that executes the Responses wire for an
 * `openai-responses` provider entry, at its configured `baseUrl` (default:
 * OpenAI's hosted API). The wire is fixed by construction, never inferred
 * from the entry's id or host; the Codex subscription client builds on this
 * one for its fixed Responses transport.
 *
 * `modelId` is the opaque llame id used for telemetry and API events.
 * `providerModelId` is the server-only model id sent to the provider.
 * @returns A model client that streams text using the configured model
 */
export function createOpenAIModelClient(
  config: OpenAIModelClientConfig,
  dependencies: OpenAIModelClientDependencies = { createOpenAI, streamText },
): ModelClient {
  const context = createResponsesClientContext(config, dependencies);

  return {
    model: config.modelId,
    provider: config.provider ?? 'openai',
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined && { pricing: config.pricing }),
    ...(config.billing !== undefined && { billing: config.billing }),
    ...(config.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: config.compactionThresholdTokens,
    }),
    ...(config.input !== undefined && { input: config.input }),
    streamText: (input: ModelStreamInput) => {
      try {
        return runOpenAIStream(context, dependencies, input);
      } catch (error) {
        throw classifiedFailure(
          error,
          providerFailureOptions(config, input.abortSignal),
        );
      }
    },
    ...(config.generateObject !== false && {
      generateObject: createStructuredObjectGenerator(context),
    }),
  };
}
