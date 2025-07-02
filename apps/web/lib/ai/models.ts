import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  ChatOpenAI,
} from "@langchain/openai";

export interface ChatModel {
  id: string;
  name?: string;
  description?: string;
  instance: BaseChatModel;
};

export function getModels(): ChatModel[] {
  return [
    {
      id: "openai:gpt-4o",
      name: "GPT-4o",
      instance: new ChatOpenAI({
        model: "gpt-4o",
      }),
    },
    {
      id: "openai:o3",
      name: "o3",
      instance: new ChatOpenAI({
        model: "o3",
      }),
    },
    {
      id: "openai:o4-mini",
      name: "o4-mini",
      instance: new ChatOpenAI({
        model: "o4-mini",
      }),
    },
    {
      id: "openai:o4-mini-high",
      name: "o4-mini-high",
      instance: new ChatOpenAI({
        model: "o4-mini",
        reasoning: {
          effort: "high",
        }
      }),
    },
    {
      id: "openai:gpt-4.5-preview-2025-02-27",
      name: "GPT-4.5",
      instance: new ChatOpenAI({
        model: "gpt-4.5-preview-2025-02-27",
      }),
    },
    {
      id: "openai:gpt-4.1",
      name: "GPT-4.1",
      instance: new ChatOpenAI({
        model: "gpt-4.1",
      }),
    },
    {
      id: "openai:gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      instance: new ChatOpenAI({
        model: "gpt-4.1-mini",
      }),
    },
  ]
}