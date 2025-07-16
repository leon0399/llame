import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatXAI } from "@langchain/xai";

export interface ChatModel {
  id: string;

  name?: string;
  description?: string; // Short 1–2 line summary
  tags?: string[];
  icon?: string; // e.g. "openai", "anthropic", "xai"
  
  contextWindow?: number;
  price?: {
    input?: number; // per token
    output?: number; // per token
  },
  knowledgeCutoff?: string; // "2024-10-01" (optional, for tracking knowledge cutoffs)
  
  reasoning?: boolean,

  website?: string // official website (e.g. https://openai.com)
  apiDocs?: string // official API docs (e.g. https://platform.openai.com/docs/api-reference)
  modelPage?: string // official product page (e.g. https://x.ai/news/grok-2)
  releasedAt?: string // "2024-12-01" (optional, for tracking changes)

  instance: BaseChatModel;
};

export function getModels(): ChatModel[] {
  return [
    {
      id: "openai:gpt-4o",
      name: "GPT-4o",
      description: "Fast, intelligent, flexible GPT model",

      contextWindow: 128000,
      price: {
        input: 2.5 / 1_000_000, // $2.50 per million input tokens
        output: 10.0 / 1_000_000, // $10.00 per million output tokens
      },
      knowledgeCutoff: "2023-10-01",

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/gpt-4o",
      modelPage: "https://platform.openai.com/docs/models/gpt-4o",
      releasedAt: "2024-08-06",

      instance: new ChatOpenAI({
        model: "gpt-4o",
      }),
    },
    {
      id: "openai:o3-pro",
      name: "o3-pro",

      contextWindow: 200_000,
      price: {
        input: 20.0 / 1_000_000, // $20.00 per million input tokens
        output: 80.0 / 1_000_000, // $80.00 per million output tokens
      },

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/o3-pro",
      modelPage: "https://platform.openai.com/docs/models/o3-pro",

      instance: new ChatOpenAI({
        model: "o3-pro",
      }),
    },
    {
      id: "openai:o3",
      name: "o3",

      contextWindow: 200_000,
      price: {
        input: 2.0 / 1_000_000, // $2.00 per million input tokens
        output: 8.0 / 1_000_000, // $8.00 per million output tokens
      },

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/o3",
      modelPage: "https://platform.openai.com/docs/models/o3",
      releasedAt: "2024-12-20",

      instance: new ChatOpenAI({
        model: "o3",
      }),
    },
    {
      id: "openai:o3-mini",
      name: "o3-mini",
      description: "A small model alternative to o3",

      contextWindow: 200_000,
      price: {
        input: 1.1 / 1_000_000, // $1.10 per million input tokens
        output: 4.4 / 1_000_000, // $4.40 per million output tokens
      },

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/o3-mini",
      modelPage: "https://platform.openai.com/docs/models/o3-mini",

      instance: new ChatOpenAI({
        model: "o3-mini",
      }),
    },
    {
      id: "openai:o4-mini",
      name: "o4-mini",
      description: "Faster, more affordable reasoning model",

      contextWindow: 200_000,
      price: {
        input: 1.1 / 1_000_000, // $1.10 per million input tokens
        output: 4.4 / 1_000_000, // $4.40 per million output tokens
      },

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/o4-mini",
      modelPage: "https://platform.openai.com/docs/models/o4-mini",

      instance: new ChatOpenAI({
        model: "o4-mini",
      }),
    },
    {
      id: "openai:o4-mini-high",
      name: "o4-mini-high",
      description: "High-effort configuration for o4-mini",

      contextWindow: 200_000,
      price: {
        input: 1.1 / 1_000_000, // $1.10 per million input tokens
        output: 4.4 / 1_000_000, // $4.40 per million output tokens
      },

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/o4-mini",
      modelPage: "https://platform.openai.com/docs/models/o4-mini",

      instance: new ChatOpenAI({
        model: "o4-mini",
        reasoning: {
          effort: "high",
        }
      }),
    },
    {
      id: "openai:gpt-4.1",
      name: "GPT-4.1",

      contextWindow: 1_047_576,
      price: {
        input: 2.0 / 1_000_000, // $2.00 per million input tokens
        output: 8.0 / 1_000_000, // $8.00 per million output tokens
      },
      knowledgeCutoff: "2024-06-01",

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/gpt-4.1",
      modelPage: "https://platform.openai.com/docs/models/gpt-4.1",

      instance: new ChatOpenAI({
        model: "gpt-4.1",
      }),
    },
    {
      id: "openai:gpt-4.1-mini",
      name: "GPT-4.1 Mini",

      contextWindow: 1_047_576,
      price: {
        input: 0.4 / 1_000_000, // $0.40 per million input tokens
        output: 1.6 / 1_000_000, // $1.60 per million output tokens
      },
      knowledgeCutoff: "2024-06-01",

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-mini",
      modelPage: "https://platform.openai.com/docs/models/gpt-4.1-mini",

      instance: new ChatOpenAI({
        model: "gpt-4.1-mini",
      }),
    },
    {
      id: "openai:gpt-4.1-nano",
      name: "GPT-4.1 Nano",

      contextWindow: 1_047_576,
      price: {
        input: 0.1 / 1_000_000, // $0.10 per million input tokens
        output: 0.4 / 1_000_000, // $0.40 per million output tokens
      },
      knowledgeCutoff: "2024-06-01",

      website: "https://openai.com",
      apiDocs: "https://platform.openai.com/docs/models/gpt-4.1-nano",
      modelPage: "https://platform.openai.com/docs/models/gpt-4.1-nano",

      instance: new ChatOpenAI({
        model: "gpt-4.1-nano",
      }),
    },
    {
      id: "anthropic:claude-4-opus",
      name: "Claude 4 Opus",

      contextWindow: 200_000,
      price: {
        input: 15.0 / 1_000_000, // $15.00 per million input tokens
        output: 75.0 / 1_000_000, // $75.00 per million output tokens
      },

      website: "https://www.anthropic.com",
      apiDocs: "https://docs.anthropic.com",
      modelPage: "https://www.anthropic.com/news/claude-4",

      instance: new ChatAnthropic({
        model: "claude-opus-4-0",
      }),
    },
    {
      id: "anthropic:claude-4-sonnet",
      name: "Claude 4 Sonnet",

      contextWindow: 200_000,
      price: {
        input: 3.0 / 1_000_000, // $3.00 per million input tokens
        output: 15.0 / 1_000_000, // $15.00 per million output tokens
      },

      website: "https://www.anthropic.com",
      apiDocs: "https://docs.anthropic.com",
      modelPage: "https://www.anthropic.com/news/claude-4",

      instance: new ChatAnthropic({
        model: "claude-sonnet-4-0",
      }),
    },
    {
      id: "xai:grok-3-mini",
      name: "Grok 3 Mini",
      instance: new ChatXAI({
        model: "grok-3-mini",
      }),
    },
    {
      id: "xai:grok-3-mini-fast",
      name: "Grok 3 Mini Fast",
      instance: new ChatXAI({
        model: "grok-3-mini-fast",
      }),
    }
  ]
}

export const DEFAULT_MODEL_ID = "openai:gpt-4o";

export const CHAT_TITLE_GENERATION_MODEL_ID = "openai:gpt-4.1-nano";