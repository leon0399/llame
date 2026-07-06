import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, streamText, tool } from 'ai';

import {
  requireModelCredential,
  type ModelClient,
  type ModelObjectInput,
  type ModelStreamInput,
} from './model-client';
import { runTokenCapReached } from './step-budget';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

/**
 * Creates a model client for streaming text with OpenAI or any
 * OpenAI-compatible endpoint (OpenRouter, groq, a local server, …).
 *
 * @param apiKey - API key for the endpoint
 * @param model - The model to use for generated text
 * @param baseUrl - OpenAI-compatible base URL; defaults to api.openai.com
 * @returns A model client that streams text using the configured model
 */
export function createOpenAIModelClient(
  apiKey: string,
  model = DEFAULT_OPENAI_MODEL,
  baseUrl?: string,
): ModelClient {
  const openai = createOpenAI({
    apiKey: requireModelCredential(apiKey),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });

  return {
    model,
    provider: 'openai',
    streamText(input: ModelStreamInput) {
      return streamText({
        // .chat (the /chat/completions API), NOT the provider default: the
        // default `openai(model)` targets OpenAI's proprietary /responses
        // endpoint, which OpenAI-compatible providers (OpenRouter, groq,
        // local servers — the whole point of OPENAI_BASE_URL, #88) do not
        // implement. Chat completions works everywhere, OpenAI included.
        model: openai.chat(model),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        // Budget (#91): the provider enforces the ceiling (stops generating at
        // the cap); the caller's onFinish handles the breach outcome.
        ...(input.maxOutputTokens !== undefined
          ? { maxOutputTokens: input.maxOutputTokens }
          : {}),
        // Tool-calling loop (MVP): the SDK auto-executes tools and re-calls the
        // model; stopWhen bounds it. Only wired when tools are present — an
        // answer-only turn keeps the single-generation path unchanged. The
        // cumulative token cap (#91) joins the step cap as a second stop
        // condition (the loop stops when EITHER fires) only when configured.
        ...(input.tools
          ? {
              tools: input.tools,
              stopWhen:
                input.maxRunTokens !== undefined
                  ? [
                      stepCountIs(input.maxSteps ?? 4),
                      ({ steps }) =>
                        runTokenCapReached(input.maxRunTokens!, steps),
                    ]
                  : stepCountIs(input.maxSteps ?? 4),
            }
          : {}),
        ...(input.onTextDelta
          ? {
              onChunk: ({ chunk }) => {
                if (chunk.type === 'text-delta') {
                  input.onTextDelta?.(chunk.text);
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
        model: openai(model),
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
