import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import {
  requireModelCredential,
  type ModelClient,
  type ModelStreamInput,
} from './model-client';

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
  };
}
