import { isTestEnvironment } from '../constants';
import {
  artifactModel as testArtifactModel,
  chatModel as testChatModel,
  reasoningModel as testReasoningModel,
  titleModel as testTitleModel,
} from './models.test';
import {
  languageModels as prodLanguageModels,
  imageModels as prodImageModels,
  artifactModel as prodArtifactModel,
  titleModel as prodTitleModel,
} from '../../config/ai.config.mjs';

const testLanguageModels = {
  'chat-model': { model: testChatModel },
  'chat-model-reasoning': { model: testReasoningModel },
} as const;

export const languageModels = (isTestEnvironment
  ? testLanguageModels
  : prodLanguageModels) as Record<string, { model: any; name?: string; description?: string }>;

export const imageModels = (isTestEnvironment ? {} : prodImageModels) as Record<string, any>;

export function languageModel(id: keyof typeof languageModels) {
  const entry = languageModels[id];
  if (!entry) throw new Error(`Unknown language model: ${id}`);
  return 'model' in entry ? entry.model : (entry as any);
}

export function imageModel(id: keyof typeof imageModels) {
  const model = imageModels[id];
  if (!model) throw new Error(`Unknown image model: ${id}`);
  return model;
}

export const titleModel = isTestEnvironment ? testTitleModel : prodTitleModel;
export const artifactModel = isTestEnvironment
  ? testArtifactModel
  : prodArtifactModel;
