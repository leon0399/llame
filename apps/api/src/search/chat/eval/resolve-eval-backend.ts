import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';

import {
  createOpenAIEmbeddingBackend,
  type OpenAIEmbeddingBackendConfig,
} from '../../openai-embedding-backend';
import { type EmbeddingBackend } from '../../core/embedding-backend';
import { isRecord } from '../../../unknown-record';

export type EvalEmbedBackend = {
  backend: EmbeddingBackend;
  modelKey: string;
  dimensions: number;
};

function resolveEnv(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^\{env:([^}:]+)(?::-(.*))?\}$/.exec(v);
  if (!m) return v;
  const envKey = m[1];
  if (!envKey) return undefined;
  const envVal = process.env[envKey];
  return envVal ?? m[2] ?? undefined;
}

export function resolveEvalEmbedBackend(): EvalEmbedBackend | undefined {
  const configPath = process.env['LLAME_CONFIG_PATH'] ?? 'llame.config.json';
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }

  const parsed: unknown = parse(raw);
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

  const credential = resolveEnv(provider['key']);
  if (!credential) return undefined;

  const dims = Number(model['dimensions']);
  if (!Number.isFinite(dims) || dims <= 0) return undefined;

  const config: OpenAIEmbeddingBackendConfig = {
    providerModelId: String(model['providerModelId']),
    dimensions: dims,
    batchSize: Number(model['batchSize'] ?? 64),
    credential,
  };

  const baseUrl = resolveEnv(provider['baseUrl']);
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
