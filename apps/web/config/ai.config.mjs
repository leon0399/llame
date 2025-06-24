import { xai } from '@ai-sdk/xai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';

export const providers = {
  xai,
  lmstudio: createOpenAICompatible({
    name: 'lmstudio',
    baseURL: 'http://localhost:1234/v1',
  }),
  openrouter: createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
  openai,
};

export const languageModels = {
  'grok-2-vision-1212': {
    model: providers.xai('grok-2-vision-1212'),
  },
  'grok-3-mini-beta': {
    model: wrapLanguageModel({
      model: providers.xai('grok-3-mini-beta'),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    }),
  },
  'gpt-4o': {
    model: providers.openai('gpt-4o'),
  },
  'gpt-4.1': {
    model: providers.openai('gpt-4.1'),
  },
  'gpt-4.5-preview-2025-02-27': {
    model: providers.openai('gpt-4.5-preview-2025-02-27'),
  },
  'o3-pro': {
    model: providers.openai('o3-pro'),
  },
  'o3': {
    model: providers.openai('o3'),
  },
  'o4-mini': {
    model: providers.openai('o4-mini'),
  },
  'o3-mini': {
    model: providers.openai('o3-mini'),
  },
};

export const imageModels = {
  'small-model': providers.xai.image('grok-2-image'),
};

export const DEFAULT_CHAT_MODEL = 'grok-2-vision-1212';

export const titleModel = providers.openai('gpt-4.1-nano');
export const artifactModel = providers.openai('gpt-4o');
