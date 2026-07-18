import { createOpenAI } from '@ai-sdk/openai';
import {
  generateText,
  NoSuchToolError,
  stepCountIs,
  streamText,
  tool,
} from 'ai';

import {
  type ModelClient,
  type ModelObjectInput,
  type ModelStreamInput,
} from './model-client';
import type { TokenPrice } from './model-catalog';

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
function parseToolCallInput(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Creates a model client for streaming text with OpenAI or any
 * OpenAI-compatible endpoint (OpenRouter, groq, a local server, …).
 *
 * `modelId` is the opaque llame id used for telemetry and API events.
 * `providerModelId` is the server-only model id sent to the provider.
 * @returns A model client that streams text using the configured model
 */
export function createOpenAIModelClient(config: {
  credential?: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
  baseUrl?: string;
  /** Native OpenAI only; compatible endpoints remain on Chat Completions. */
  nativeOpenAI?: boolean;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
}): ModelClient {
  const openai = createOpenAI({
    // A keyless provider (empty/absent credential) still needs a non-empty
    // apiKey passed through — see KEYLESS_PLACEHOLDER_API_KEY.
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    model: config.modelId,
    provider: 'openai',
    contextWindowTokens: config.contextWindowTokens,
    ...(config.pricing !== undefined ? { pricing: config.pricing } : {}),
    ...(config.compactionThresholdTokens !== undefined
      ? { compactionThresholdTokens: config.compactionThresholdTokens }
      : {}),
    streamText(input: ModelStreamInput) {
      return streamText({
        // Only the configured native OpenAI provider uses Responses. Every
        // compatible endpoint stays on Chat Completions.
        model: config.nativeOpenAI
          ? openai(config.providerModelId)
          : openai.chat(config.providerModelId),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        ...(config.nativeOpenAI
          ? { providerOptions: { openai: { reasoningSummary: 'auto' } } }
          : {}),
        // Tool-calling loop: the SDK auto-executes tools and re-calls the
        // model. Only wired when tools are present — an answer-only turn
        // keeps the single-generation path unchanged.
        ...(input.tools
          ? {
              tools: input.tools,
              ...(input.toolChoice !== undefined
                ? { toolChoice: input.toolChoice }
                : {}),
              // Backstop only: prepareStep below disables tools once the
              // cap is reached, which naturally ends the loop on the next
              // (tool-free, text-only) step — this just bounds the
              // worst case if a step somehow still requests a tool after that.
              stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
              // Step-cap enforcement (SPEC tool-calling): once `maxSteps`
              // PRIOR steps have requested a tool, stop declaring tools for
              // the next step — the model is forced to answer from
              // accumulated context in the SAME streamText() call, rather
              // than the run ending mid tool-call.
              prepareStep: ({ steps }) => {
                const priorToolSteps = steps.filter(
                  (step) => step.toolCalls.length > 0,
                ).length;
                if (priorToolSteps >= (input.maxSteps ?? 8)) {
                  input.onCapReached?.();
                  return { activeTools: [] };
                }
                return {};
              },
              // A model can request a tool name it wasn't declared (gate
              // refusal / hallucination) or pass arguments its schema
              // rejects. Record the refusal for durability, then return
              // null so the SDK's own non-crashing fallback (a synthesized
              // tool-error result) still runs — the run never crashes.
              experimental_repairToolCall: ({ toolCall, error }) => {
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
              },
            }
          : {}),
        ...(input.onTextDelta || input.onReasoningDelta
          ? {
              onChunk: ({ chunk }) => {
                if (chunk.type === 'text-delta') {
                  input.onTextDelta?.(chunk.text);
                } else if (chunk.type === 'reasoning-delta') {
                  input.onReasoningDelta?.(chunk.text);
                }
              },
            }
          : {}),
        onError: input.onError,
        onFinish: input.onFinish,
      });
    },
    async generateObject<OBJECT>(input: ModelObjectInput<OBJECT>) {
      // Forced tool call (toolChoice pins the named tool — OpenAI
      // `tool_choice: {type: 'function', ...}`): the API requires the model to
      // call the tool, so the output can't ramble the way free text can.
      // Chosen over generateObject's response_format json_schema because tool
      // calling is more widely implemented across OpenAI-compatible backends.
      // The SDK validates the call's input against the schema; a backend that
      // can't comply throws (or returns no call) — callers keep a fallback.
      const toolName = input.schemaName ?? 'output';
      const result = await generateText({
        // .chat (chat/completions), same as streamText above: the default
        // `openai(model)` targets OpenAI's /responses endpoint, which
        // OpenAI-compatible backends (the point of OPENAI_BASE_URL, #88) don't
        // implement — structured title generation must work everywhere too.
        model: openai.chat(config.providerModelId),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
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
        throw new Error(
          `Model did not produce a valid '${toolName}' tool call`,
        );
      }

      return call.input;
    },
  };
}
