import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createOpenAIEmbeddingBackend,
  type OpenAIEmbeddingBackendConfig,
} from '../../openai-embedding-backend';
import { type EmbeddingBackend } from '../../core/embedding-backend';
import { parseConfigText } from '../../../instance-config/config-loader';
import {
  interpolateString,
  InterpolationError,
} from '@workspace/config-interpolation';
import { isRecord } from '@workspace/runtime-safety';

export type EvalEmbedBackend = {
  backend: EmbeddingBackend;
  modelKey: string;
  dimensions: number;
};

/**
 * Resolve a credential/baseUrl single value: `{env:...}` / `{path:...}`
 * tokens through the shared interpolator, plain literals unchanged. A required
 * token that cannot resolve is a misconfiguration, so it yields `undefined`
 * (the caller's no-backend case) rather than a literal token being sent.
 */
export function resolveSecret(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    return interpolateString(v);
  } catch (error) {
    if (error instanceof InterpolationError) return undefined;
    throw error;
  }
}

export function resolveEvalEmbedBackend(): EvalEmbedBackend | undefined {
  const configPath = path.resolve(
    process.cwd(),
    process.env['LLAME_CONFIG_PATH'] ?? 'llame.config.jsonc',
  );
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = parseConfigText(raw, configPath);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const search = parsed['search'];
  if (!isRecord(search)) return undefined;
  const chats = search['chats'];
  if (!isRecord(chats)) return undefined;
  const modelId = chats['embeddingModelId'];
  if (typeof modelId !== 'string') return undefined;

  const models = parsed['embeddingModels'];
  const providers = parsed['providers'];
  if (!Array.isArray(models) || !Array.isArray(providers)) return undefined;

  const model = models.find((m: unknown) => isRecord(m) && m['id'] === modelId);
  if (!isRecord(model)) return undefined;

  const modelProvider = model['provider'];
  if (typeof modelProvider !== 'string') return undefined;

  const provider = providers.find(
    (p: unknown) => isRecord(p) && p['id'] === modelProvider,
  );
  if (!isRecord(provider)) return undefined;

  const credential = resolveSecret(provider['key']);
  if (!credential) return undefined;

  const dims = Number(model['dimensions']);
  if (!Number.isFinite(dims) || dims <= 0) return undefined;

  const providerModelId = model['providerModelId'];
  if (typeof providerModelId !== 'string') return undefined;

  const config: OpenAIEmbeddingBackendConfig = {
    providerModelId,
    dimensions: dims,
    batchSize: Number(model['batchSize'] ?? 64),
    credential,
  };

  const baseUrl = resolveSecret(provider['baseUrl']);
  if (baseUrl) config.baseUrl = baseUrl;

  const qp = model['queryPrefix'];
  if (typeof qp === 'string') config.queryPrefix = qp;
  const dp = model['documentPrefix'];
  if (typeof dp === 'string') config.documentPrefix = dp;

  return {
    backend: createOpenAIEmbeddingBackend(config),
    modelKey: modelId,
    dimensions: dims,
  };
}
