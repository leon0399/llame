import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import {
  requireModelCredential,
  type ModelClient,
  type ModelStreamInput,
} from './model-client';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

/**
 * Creates a model client for streaming text with OpenAI.
 *
 * @param apiKey - OpenAI API key
 * @param model - The model to use for generated text
 * @returns A model client that streams text using the configured OpenAI model
 */
export function createOpenAIModelClient(
  apiKey: string,
  model = DEFAULT_OPENAI_MODEL,
): ModelClient {
  const openai = createOpenAI({
    apiKey: requireModelCredential(apiKey),
  });

  return {
    model,
    provider: 'openai',
    streamText(input: ModelStreamInput) {
      return streamText({
        model: openai(model),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        onError: input.onError,
        onFinish: input.onFinish,
      });
    },
  };
}
