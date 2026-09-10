import {
  createOpenAIModelClient,
  type OpenAIModelClientDependencies,
} from './openai-model-client';
import type { ModelClient } from './model-client';
import type { TokenPrice } from './model-catalog';

export const CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';

type OpenAICodexModelClientConfig = {
  credential: string;
  accountId: string;
  providerModelId: string;
  modelId: string;
  contextWindowTokens: number;
  pricing?: TokenPrice;
  compactionThresholdTokens?: number;
};

function rejectRedirects(fetchImplementation: typeof globalThis.fetch) {
  return (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    fetchImplementation(input, { ...init, redirect: 'manual' });
}

export function createOpenAICodexModelClient(
  config: OpenAICodexModelClientConfig,
  dependencies: OpenAIModelClientDependencies = { createOpenAI, streamText },
): ModelClient {
  return createOpenAIModelClient(
    {
      credential: config.credential,
      providerModelId: config.providerModelId,
      modelId: config.modelId,
      contextWindowTokens: config.contextWindowTokens,
      nativeOpenAI: true,
      baseUrl: CODEX_RESPONSES_BASE_URL,
      headers: {
        'ChatGPT-Account-ID': config.accountId,
        Accept: 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
        Originator: 'llame',
      },
      fetch: rejectRedirects(globalThis.fetch),
      storeResponses: false,
      generateObject: false,
      provider: 'openai-codex',
      ...(config.pricing !== undefined && { pricing: config.pricing }),
      ...(config.compactionThresholdTokens !== undefined && {
        compactionThresholdTokens: config.compactionThresholdTokens,
      }),
    },
    dependencies,
  );
}
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
