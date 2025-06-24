import { createProviderRegistry } from 'ai';
import { openai } from '@ai-sdk/openai';

export const registry = createProviderRegistry({
  openai
});

export const languageModels = {
  'openai:gpt-4o': {
    model: registry.languageModel('openai:gpt-4o'),
    name: 'OpenAI GPT-4o',
    description: 'Great for most tasks',
  },
  'openai:gpt-4.1': {
    model: registry.languageModel('openai:gpt-4.1'),
    name: 'OpenAI GPT-4.1',
    description: 'Great for quick coding and analysis',
  },
  'openai:gpt-4.5-preview-2025-02-27': {
    model: registry.languageModel('openai:gpt-4.5-preview-2025-02-27'),
    name: 'OpenAI GPT-4.5',
    description: 'Good for writing and exploring ideas',
  },
  'openai:o3-pro': {
    model: registry.languageModel('openai:o3-pro'),
    name: 'OpenAI o3-pro',
  },
  'openai:o3': {
    model: registry.languageModel('openai:o3'),
    name: 'OpenAI o3',
    description: 'Uses advanced reasoning',
  },
  'openai:o4-mini': {
    model: registry.languageModel('openai:o4-mini'),
    name: 'OpenAI o4-mini',
    description: 'Fastest at advanced reasoning',
  },
  'openai:o3-mini': {
    model: registry.languageModel('openai:o3-mini'),
    name: 'OpenAI o3-mini',
  },
  'openai:gpt-4.1-mini': {
    model: registry.languageModel('openai:gpt-4.1-mini'),
    name: 'OpenAI GPT-4.1-mini',
    description: 'Faster for everyday tasks',
  }
};

export const imageModels = {
  'small-model': registry.imageModel('openai:gpt-image-1'),
};

export const DEFAULT_CHAT_MODEL = 'openai:gpt-4o';

export const titleModel = registry.languageModel('openai:gpt-4.1-nano');
export const artifactModel = registry.languageModel('openai:gpt-4o');
