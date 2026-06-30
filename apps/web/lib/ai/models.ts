export interface ChatModel {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  contextWindow?: number;
  price?: {
    input?: number;
    output?: number;
  };
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
}

export const DEFAULT_MODEL_ID = "openai:gpt-4o";

export const STATIC_CHAT_MODELS: ChatModel[] = [
  {
    id: "openai:gpt-4o",
    name: "GPT-4o",
    description: "Fast, intelligent, flexible GPT model",
    contextWindow: 128000,
    price: {
      input: 2.5 / 1_000_000,
      output: 10.0 / 1_000_000,
    },
    knowledgeCutoff: "2023-10-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4o",
    modelPage: "https://platform.openai.com/docs/models/gpt-4o",
    releasedAt: "2024-08-06",
  },
  {
    id: "openai:o3-pro",
    name: "o3-pro",
    contextWindow: 200_000,
    price: {
      input: 20.0 / 1_000_000,
      output: 80.0 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3-pro",
    modelPage: "https://platform.openai.com/docs/models/o3-pro",
  },
  {
    id: "openai:o3",
    name: "o3",
    contextWindow: 200_000,
    price: {
      input: 2.0 / 1_000_000,
      output: 8.0 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3",
    modelPage: "https://platform.openai.com/docs/models/o3",
    releasedAt: "2024-12-20",
  },
  {
    id: "openai:o3-mini",
    name: "o3-mini",
    description: "A small model alternative to o3",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o3-mini",
    modelPage: "https://platform.openai.com/docs/models/o3-mini",
  },
  {
    id: "openai:o4-mini",
    name: "o4-mini",
    description: "Faster, more affordable reasoning model",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o4-mini",
    modelPage: "https://platform.openai.com/docs/models/o4-mini",
  },
  {
    id: "openai:o4-mini-high",
    name: "o4-mini-high",
    description: "High-effort configuration for o4-mini",
    contextWindow: 200_000,
    price: {
      input: 1.1 / 1_000_000,
      output: 4.4 / 1_000_000,
    },
    reasoning: true,
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/o4-mini",
    modelPage: "https://platform.openai.com/docs/models/o4-mini",
  },
  {
    id: "openai:gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1_047_576,
    price: {
      input: 2.0 / 1_000_000,
      output: 8.0 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1",
  },
  {
    id: "openai:gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    contextWindow: 1_047_576,
    price: {
      input: 0.4 / 1_000_000,
      output: 1.6 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-mini",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1-mini",
  },
  {
    id: "openai:gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    contextWindow: 1_047_576,
    price: {
      input: 0.1 / 1_000_000,
      output: 0.4 / 1_000_000,
    },
    knowledgeCutoff: "2024-06-01",
    website: "https://openai.com",
    apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-nano",
    modelPage: "https://platform.openai.com/docs/models/gpt-4.1-nano",
  },
  {
    id: "anthropic:claude-4-opus",
    name: "Claude 4 Opus",
    contextWindow: 200_000,
    price: {
      input: 15.0 / 1_000_000,
      output: 75.0 / 1_000_000,
    },
    website: "https://www.anthropic.com",
    apiDocs: "https://docs.anthropic.com",
    modelPage: "https://www.anthropic.com/news/claude-4",
  },
  {
    id: "anthropic:claude-4-sonnet",
    name: "Claude 4 Sonnet",
    contextWindow: 200_000,
    price: {
      input: 3.0 / 1_000_000,
      output: 15.0 / 1_000_000,
    },
    website: "https://www.anthropic.com",
    apiDocs: "https://docs.anthropic.com",
    modelPage: "https://www.anthropic.com/news/claude-4",
  },
  {
    id: "xai:grok-3-mini",
    name: "Grok 3 Mini",
  },
  {
    id: "xai:grok-3-mini-fast",
    name: "Grok 3 Mini Fast",
  },
];
