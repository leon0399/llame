import type { LlameConfig } from '../../../instance-config/llame-config';
import { loadInstanceConfig } from '../../../instance-config/config-loader';
import { createOpenAIEmbeddingBackend } from '../../openai-embedding-backend';
import { resolveEmbeddingBackendConfig } from '../../search-embed.worker';
import type { EmbeddingBackend } from '../../core/embedding-backend';

export type EvalEmbedBackend = {
  backend: EmbeddingBackend;
  modelKey: string;
  dimensions: number;
};

/** Evaluation uses the same account, wire, credential and header resolution as the worker. */
export function resolveEvalEmbedBackend(): EvalEmbedBackend | undefined {
  let config: LlameConfig;

  try {
    config = loadInstanceConfig();
  } catch {
    return undefined;
  }

  const model = config.embeddingModels.find(
    (entry) => entry.id === config.search.chats.embeddingModelId,
  );

  if (model === undefined) return undefined;

  return {
    backend: createOpenAIEmbeddingBackend(
      resolveEmbeddingBackendConfig(model, config.providers),
    ),
    modelKey: model.id,
    dimensions: model.dimensions,
  };
}
