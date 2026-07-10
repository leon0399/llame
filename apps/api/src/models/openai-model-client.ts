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
}): ModelClient {
  const openai = createOpenAI({
    ...(config.credential ? { apiKey: config.credential } : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return {
    model: config.modelId,
    provider: 'openai',
    contextWindowTokens: config.contextWindowTokens,
    streamText(input: ModelStreamInput) {
      return streamText({
        // .chat (the /chat/completions API), NOT the provider default: the
        // default `openai(model)` targets OpenAI's proprietary /responses
        // endpoint, which OpenAI-compatible providers (OpenRouter, groq,
        // local servers — the whole point of OPENAI_BASE_URL, #88) do not
        // implement. Chat completions works everywhere, OpenAI included.
        model: openai.chat(config.providerModelId),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        // Tool-calling loop: the SDK auto-executes tools and re-calls the
        // model. Only wired when tools are present — an answer-only turn
        // keeps the single-generation path unchanged.
        ...(input.tools
          ? {
              tools: input.tools,
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
