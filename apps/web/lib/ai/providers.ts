import { 
  type ClientOptions as OpenAIClientOptions,
} from "@langchain/openai";

export type ModelProviderType = "openai" | "anthropic";

export interface BaseModelProvider {
  id: string;
  type: ModelProviderType;
}

export interface OpenAIModelProvider extends BaseModelProvider {
  type: "openai";
  openai: OpenAIClientOptions;
}

export type ModelProvider = OpenAIModelProvider;

// todo: temporary
const modelProviders: ModelProvider[] = [
  {
    id: "openai",
    type: "openai",
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  }
]

export function getModelProviders(): ModelProvider[] {
  return modelProviders;
}