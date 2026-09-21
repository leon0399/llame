import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import {
  generateText,
  NoSuchToolError,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
} from 'ai';

import {
  type ModelClient,
  type ModelObjectInput,
  type ModelStreamInput,
  type ModelStreamResult,
} from './model-client';
import type { TokenPrice } from './model-catalog';
import {
  composeProviderOptions,
  type ProviderOptionRecord,
} from './provider-options';
import { consumeReasoningStream } from './reasoning-stream';
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
 * Best-effort parse of a tool call's raw stringified-JSON `input`
 * (`LanguageModelV3ToolCall.input` is always a string at the provider
 * layer). Falls back to the raw string when it isn't valid JSON, rather
 * than throwing — a hallucinating model's malformed arguments are still a
 * recorded observation, not a crash.
 */
function parseToolCallInput(raw: string) {
  try {
    // SAFETY: JSON.parse returns any; asserting unknown forces the caller to
    // narrow before use (the catch below is this function's own fallback).
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
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

/**
 * Tool-calling loop: the SDK auto-executes tools and re-calls the model.
 * Only wired when tools are present — an answer-only turn keeps the single-
 * generation path unchanged. Mutates `streamOptions` in place, matching the
 * incremental build-up style the rest of `streamText` already uses. Shared
 * by every wire's client (exported for `openai-completions-model-client`),
 * so step-cap accounting and refusal reporting stay single-sourced.
 */
export function applyToolCallingOptions(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
): void {
  if (!input.tools) return;

  // Always set strict: false — Responses may rewrite omitted strict into
  // required-nullable optionals; Chat Completions ignores the flag.
  streamOptions.tools = disableStrictToolSchemas(input.tools);
  if (input.toolChoice !== undefined) {
    streamOptions.toolChoice = input.toolChoice;
  }
  // Backstop only: prepareStep below disables tools once the
  // cap is reached, which naturally ends the loop on the next
  // (tool-free, text-only) step — this just bounds the
  // worst case if a step somehow still requests a tool after that.
  streamOptions.stopWhen = stepCountIs((input.maxSteps ?? 8) + 1);
  // Step-cap enforcement (SPEC tool-calling): once `maxSteps`
  // PRIOR steps have requested a tool, stop declaring tools for
  // the next step — the model is forced to answer from
  // accumulated context in the SAME streamText() call, rather
  // than the run ending mid tool-call.
  streamOptions.prepareStep = ({ steps }) => {
    const priorToolSteps = steps.filter(
      (step) => step.toolCalls.length > 0,
    ).length;
    if (priorToolSteps >= (input.maxSteps ?? 8)) {
      input.onCapReached?.();
      return { activeTools: [] };
    }
    return {};
  };
  // A model can request a tool name it wasn't declared (gate
  // refusal / hallucination) or pass arguments its schema
  // rejects. Record the refusal for durability, then return
  // null so the SDK's own non-crashing fallback (a synthesized
  // tool-error result) still runs — the run never crashes.
  streamOptions.experimental_repairToolCall = ({ toolCall, error }) => {
    input.onUnavailableToolCall?.({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      // `LanguageModelV3ToolCall.input` is ALWAYS a stringified
      // JSON object at this provider-level layer (never
      // pre-parsed — there's no schema to parse against for a
      // NoSuchToolError, and InvalidToolInputError is exactly
      // "didn't match one"), so parse it best-effort for a
      // structured, human-readable persisted/streamed record; a
      // model that sent malformed JSON gets the raw string
      // instead of a thrown error here.
      input: parseToolCallInput(toolCall.input),
      reason: NoSuchToolError.isInstance(error)
        ? 'not_available'
        : 'invalid_input',
    });
    return Promise.resolve(null);
  };
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
 * Queues the SDK's terminal callbacks instead of awaiting them inside its
 * pipeline, which would deadlock the `fullStream` branch they must follow.
 * The client binds the returned queue to its single reasoning consumer after
 * `streamText` returns.
 */
export function deferTerminalCallbacks(
  streamOptions: TerminalCallbackOptions,
  input: ModelStreamInput,
): DeferredTerminals {
  const terminals = createDeferredTerminals();
  if (input.onReasoningDelta === undefined) return terminals;

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

/** Binds the queue to the request's one reasoning-stream consumer. */
export function bindReasoningChannel(
  terminals: DeferredTerminals,
  result: Pick<ModelStreamResult, 'fullStream'>,
  input: ModelStreamInput,
): void {
  if (input.onReasoningDelta !== undefined) {
    terminals.bind(
      consumeReasoningStream(result.fullStream, input.onReasoningDelta),
    );
  }
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
  sanitizeError?: (error: unknown) => Error,
): Promise<never> {
  await terminals.wait();
  throw sanitizeError?.(error) ?? error;
}

async function awaitTextAndAbortSettlement(
  text: PromiseLike<string>,
  settlement: AbortSettlement,
  terminals: DeferredTerminals,
  sanitizeError?: (error: unknown) => Error,
): Promise<string> {
  try {
    const value = await text;
    await settlement.wait();
    return value;
  } catch (error) {
    try {
      await settlement.wait();
    } catch (settlementError) {
      await throwAfterTerminalCompletion(
        terminals,
        settlementError,
        sanitizeError,
      );
    }
    return throwAfterTerminalCompletion(terminals, error, sanitizeError);
  }
}

async function awaitTextAfterSettlement(
  text: PromiseLike<string>,
  settlement: AbortSettlement,
  terminals: DeferredTerminals,
  sanitizeError?: (error: unknown) => Error,
): Promise<string> {
  const value = await awaitTextAndAbortSettlement(
    text,
    settlement,
    terminals,
    sanitizeError,
  );
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
  sanitizeError?: (error: unknown) => Error,
  terminals: DeferredTerminals = createDeferredTerminals(),
): ModelStreamResult {
  return wrapStreamTextResult(result, {
    consumeStream: (target) => ({
      value: async (...args: Parameters<typeof target.consumeStream>) => {
        try {
          await target.consumeStream(...args);
          await settlement.wait();
        } catch (error) {
          await throwAfterTerminalCompletion(terminals, error, sanitizeError);
        }
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

export type OpenAIModelClientConfig = {
  credential?: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
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
   * operator layer alone.
   */
  providerOptions?: ProviderOptionRecord;
  /**
   * Client-owned options no operator value — `null` included — can remove or
   * replace (design D5). The codex subscription transport pins `store: false`
   * and `reasoningSummary: 'auto'` here; the plain Responses client leaves it
   * unset.
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
  /** Replaces provider errors before they enter the run lifecycle. */
  sanitizeError?: (error: unknown) => Error;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
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
 * One composed record under the Responses wire's `openai` namespace — the
 * namespace `@ai-sdk/openai` reads its own options from, for a streaming and a
 * structured-generation request alike. An empty composition contributes
 * nothing, so a request that composes to nothing sends exactly the body it
 * sent before this layer.
 */
function responsesProviderOptions(
  composed: ProviderOptionRecord | undefined,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return composed === undefined
    ? {}
    : { providerOptions: { openai: composed } };
}

/**
 * Attaches the request's provider options, composed from four layers under
 * one precedence (design D5): this wire's per-request-kind default (the
 * displayable reasoning summary, which the structured-generation path does
 * not take — see `composeStructuredProviderOptions`), the operator's object,
 * the run's effort, and the client's invariants — each layer replaces or
 * removes what the earlier ones set, never the other way around. The
 * operator's reserved paths are stripped by the composer.
 *
 * A request whose options compose to nothing (every default removed with
 * `null`, no operator or effort value) carries no `providerOptions` key at
 * all, so an entry with no configured options sends exactly the body it sent
 * before this layer. `!== undefined` rather than truthiness for the effort —
 * a level meaning "no reasoning" is an instruction to send, not an absence.
 */
function applyProviderOptions(
  streamOptions: Parameters<typeof streamText>[0],
  config: OpenAIModelClientConfig,
  input: ModelStreamInput,
): void {
  const { providerOptions } = responsesProviderOptions(
    composeProviderOptions({
      defaults: { reasoningSummary: 'auto' },
      ...(config.providerOptions !== undefined && {
        operator: config.providerOptions,
      }),
      ...(input.effort !== undefined && {
        effort: { reasoningEffort: input.effort },
      }),
      ...(config.providerOptionInvariants !== undefined && {
        invariants: config.providerOptionInvariants,
      }),
      reservedPaths: RESPONSES_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  );
  if (providerOptions !== undefined) {
    streamOptions.providerOptions = providerOptions;
  }
}

/**
 * The structured-generation path's options: the operator's
 * `models[].providerOptions` under this wire's namespace with its reserved
 * paths stripped, and no other layer (provider-api-selection: the entry's
 * options reach every language-model request). The displayable reasoning
 * summary is a streaming default and is not added here; `ModelObjectInput`
 * carries no effort, so there is no run layer; and the Codex transport — the
 * only client that pins invariants — exposes no structured generation, so
 * none applies. Composes to nothing for an entry that configures no options,
 * which leaves this path's option-free request exactly as it was.
 */
function composeStructuredProviderOptions(
  config: OpenAIModelClientConfig,
): Pick<Parameters<typeof streamText>[0], 'providerOptions'> {
  return responsesProviderOptions(
    composeProviderOptions({
      ...(config.providerOptions !== undefined && {
        operator: config.providerOptions,
      }),
      reservedPaths: RESPONSES_RESERVED_PROVIDER_OPTION_PATHS,
    }),
  );
}

/**
 * `onChunk` carries the answer's text deltas only — it is called for deltas
 * alone, so it can never see the reasoning metadata a part carries. Reasoning,
 * text and metadata alike, is forwarded by ONE consumer of the result's
 * `fullStream` (`consumeReasoningStream`): a single path for the whole channel
 * keeps part boundaries, metadata binding, and their order in one place, and a
 * metadata-only delivery that starts a block can never overtake the text that
 * precedes it (design D18).
 */
function applyTextDeltaCallback(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
): void {
  if (!input.onTextDelta) return;
  streamOptions.onChunk = ({ chunk }) => {
    if (chunk.type === 'text-delta') {
      input.onTextDelta?.(chunk.text);
    }
  };
}

function runOpenAIStream(
  openai: ReturnType<typeof createOpenAI>,
  config: OpenAIModelClientConfig,
  dependencies: OpenAIModelClientDependencies,
  input: ModelStreamInput,
): ModelStreamResult {
  const sanitizedInput =
    config.sanitizeError === undefined
      ? input
      : {
          ...input,
          onError: ({ error }: { error: unknown }) =>
            input.onError?.({ error: config.sanitizeError?.(error) ?? error }),
        };
  const streamOptions: Parameters<typeof streamText>[0] = {
    // The declared Responses wire (design D1): the provider callable's
    // default entry point targets /responses at the configured base URL.
    model: openai(config.providerModelId),
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    onError: sanitizedInput.onError,
    onFinish: input.onFinish,
    ...(config.maxOutputTokens !== undefined && {
      maxOutputTokens: config.maxOutputTokens,
    }),
  };
  applyProviderOptions(streamOptions, config, input);
  applyToolCallingOptions(streamOptions, input);
  applyTextDeltaCallback(streamOptions, input);
  // SDK callbacks return immediately so the `fullStream` reasoning branch can
  // close; the run's callbacks and abort persistence then execute in order
  // behind that branch (D18).
  const terminals = deferTerminalCallbacks(streamOptions, input);
  const settlement = trackAbortSettlement(input, terminals);
  streamOptions.onAbort = settlement.onAbort;
  const result = dependencies.streamText(streamOptions);
  bindReasoningChannel(terminals, result, input);

  return awaitSettlementAfter(
    result,
    settlement,
    config.sanitizeError,
    terminals,
  );
}

/**
 * Forced tool call (toolChoice pins the named tool — OpenAI
 * `tool_choice: {type: 'function', ...}`): the API requires the model to
 * call the tool, so the output can't ramble the way free text can. Chosen
 * over generateObject's response_format json_schema because tool calling is
 * more widely implemented across OpenAI-compatible backends. The SDK
 * validates the call's input against the schema; a backend that can't comply
 * throws (or returns no call) — callers keep a fallback.
 *
 * `model` is the caller's declared wire's model (design D1/D4): a
 * Responses-typed provider's structured generation — chat titles included —
 * runs on Responses, a completions-typed provider's on Chat Completions.
 * Never a hardcoded wire.
 *
 * `callSettings` carries the wire's own request options, already composed by
 * the client whose wire `model` belongs to: its `providerOptions` — that
 * client owns its namespace, its reserved paths, and which layers a
 * structured request takes — and the catalog entry's `maxOutputTokens` cap
 * (design D17), which is a call setting rather than a provider option. This
 * shared path stays wire-agnostic and composes nothing itself, so a caller
 * that composes to nothing sets neither key.
 */
export async function generateToolBoundObject<OBJECT>(
  model: LanguageModelV3,
  input: ModelObjectInput<OBJECT>,
  callSettings: Pick<
    Parameters<typeof streamText>[0],
    'maxOutputTokens' | 'providerOptions'
  >,
): Promise<OBJECT> {
  const toolName = input.schemaName ?? 'output';
  const result = await generateText({
    model,
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    ...callSettings,
    tools: {
      [toolName]: tool({
        description: input.schemaDescription,
        inputSchema: input.schema,
      }),
    },
    toolChoice: { type: 'tool', toolName },
  });

  // `dynamic` is the discriminant: unparsable/invalid calls surface as
  // dynamic, valid static calls carry the schema-typed input.
  const call = result.toolCalls[0];
  if (!call || call.dynamic) {
    throw new Error(`Model did not produce a valid '${toolName}' tool call`);
  }

  return call.input;
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
  const openai = dependencies.createOpenAI({
    // A keyless provider (empty/absent credential) still needs a non-empty
    // apiKey passed through — see KEYLESS_PLACEHOLDER_API_KEY.
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
    ...(config.baseUrl && { baseURL: config.baseUrl }),
    ...(config.headers && { headers: config.headers }),
    ...(config.fetch && { fetch: config.fetch }),
  });

  return {
    model: config.modelId,
    provider: config.provider ?? 'openai',
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined && { pricing: config.pricing }),
    ...(config.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: config.compactionThresholdTokens,
    }),
    streamText: (input: ModelStreamInput) => {
      try {
        return runOpenAIStream(openai, config, dependencies, input);
      } catch (error) {
        throw config.sanitizeError?.(error) ?? error;
      }
    },
    ...(config.generateObject !== false && {
      generateObject: <OBJECT>(input: ModelObjectInput<OBJECT>) =>
        generateToolBoundObject(openai(config.providerModelId), input, {
          ...composeStructuredProviderOptions(config),
          ...(config.maxOutputTokens !== undefined && {
            maxOutputTokens: config.maxOutputTokens,
          }),
        }),
    }),
  };
}
