import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import {
  requireModelCredential,
  type ModelClient,
  type ModelStreamInput,
} from './model-client';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export function createOpenAIModelClient(
  apiKey: string,
  model = DEFAULT_OPENAI_MODEL,
): ModelClient {
  const openai = createOpenAI({
    apiKey: requireModelCredential(apiKey),
  });

  return {
    streamText(input: ModelStreamInput) {
      return streamText({
        model: openai(model),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
      });
    },
  };
}
