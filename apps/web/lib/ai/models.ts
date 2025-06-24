import { DEFAULT_CHAT_MODEL, languageModels } from '../../config/ai.config.mjs';

export interface ChatModel {
  id: string;
  name: string;
  description?: string;
}

const languageModelsTyped = languageModels as Record<string, { name?: string; description?: string }>;

export const chatModels: ChatModel[] = Object.entries(languageModelsTyped).map(
  ([id, value]) => ({
    id,
    name: value.name ?? id,
    description: value.description,
  }),
);

export { DEFAULT_CHAT_MODEL };
