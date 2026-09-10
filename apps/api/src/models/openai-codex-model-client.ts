import { createOpenAI } from '@ai-sdk/openai';
import { RetryError, streamText } from 'ai';
import { isNumber, isRecord } from '@workspace/runtime-safety';

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

function directHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const statusCode = error['statusCode'];
  return isNumber(statusCode) ? statusCode : undefined;
}

function httpStatus(error: unknown): number | undefined {
  const statusCode = directHttpStatus(error);
  if (statusCode !== undefined) return statusCode;
  if (!RetryError.isInstance(error)) return undefined;
  return error.errors
    .map(directHttpStatus)
    .find((status): status is number => status !== undefined);
}

function sanitizeCodexError(error: unknown): Error {
  const statusCode = httpStatus(error);
  if (statusCode === 401 || statusCode === 403) {
    return new Error(
      'Codex subscription authentication failed. Re-login and restart llame.',
    );
  }
  if (statusCode === 429) {
    return new Error('Codex subscription limit reached. Retry manually later.');
  }
  return new Error('Codex subscription request failed.');
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
      sanitizeError: sanitizeCodexError,
      ...(config.pricing !== undefined && { pricing: config.pricing }),
      ...(config.compactionThresholdTokens !== undefined && {
        compactionThresholdTokens: config.compactionThresholdTokens,
      }),
    },
    dependencies,
  );
}
