import { InstanceConfigError } from '@workspace/config-interpolation';
import type { ProviderConfig } from './llame-config';
import type { RequestHeaderTemplates } from '../models/request-headers';
import type { BillingMode } from '../models/model-client';

/** One vendor account shared by every model kind it serves. */
export type VendorProviderConfig = {
  id: string;
  type: 'openai' | 'anthropic' | 'openrouter' | 'opencode-zen';
  billing?: BillingMode;
  key: string | null;
  baseUrl: string | null;
  headers: RequestHeaderTemplates;
};

export type RawVendorProviderEntry = {
  id: string;
  type: VendorProviderConfig['type'];
  billing?: BillingMode;
  key?: unknown;
  baseUrl?: unknown;
  headers?: Record<string, string | null>;
};

export type ModelWire =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages'
  | 'openai-codex'
  | 'openai-embeddings'
  | 'system-one'
  | 'cohere-rerank';

export type ModelKind = 'chat' | 'embedding' | 'decision' | 'rerank';

const KIND_WIRES: Record<ModelKind, ReadonlyArray<ModelWire>> = {
  chat: [
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
    'openai-codex',
  ],
  embedding: ['openai-embeddings'],
  decision: ['system-one'],
  rerank: ['cohere-rerank'],
};

type VendorDefaults = Partial<
  Record<ProviderConfig['type'], Partial<Record<ModelKind, ModelWire>>>
>;

const VENDOR_DEFAULTS: VendorDefaults = {
  openai: { chat: 'openai-responses', embedding: 'openai-embeddings' },
  anthropic: { chat: 'anthropic-messages' },
  openrouter: {
    chat: 'openai-completions',
    embedding: 'openai-embeddings',
    decision: 'system-one',
    rerank: 'cohere-rerank',
  },
  'openai-responses': {
    chat: 'openai-responses',
    embedding: 'openai-embeddings',
  },
  'openai-completions': {
    chat: 'openai-completions',
    embedding: 'openai-embeddings',
  },
  'anthropic-messages': { chat: 'anthropic-messages' },
  'openai-codex': { chat: 'openai-codex' },
  'system-one': { decision: 'system-one' },
  'cohere-rerank': { rerank: 'cohere-rerank' },
};

// OMP's verified route pins take precedence over family defaults. Unknown
// families require an explicit wire; a new name is not evidence of a protocol.
function openCodeChatWire(type: string, model: string): ModelWire | undefined {
  if (model.startsWith('claude-') || model === 'union-alpha')
    return 'anthropic-messages';

  if (/^(?:gpt-|grok-|muse-spark-)/u.test(model)) return 'openai-responses';

  if (type === 'opencode-go' && model === 'deepseek-v4-flash')
    return 'openai-responses';

  if (/^(?:glm-|kimi-|deepseek-|minimax-)/u.test(model))
    return 'openai-completions';

  if (
    type === 'opencode-go' &&
    /^(?:qwen3\.5-plus|qwen3\.6-plus)$/u.test(model)
  ) {
    return 'openai-completions';
  }

  if (model.startsWith('qwen')) return 'anthropic-messages';

  return undefined;
}

function defaultWire(
  provider: ProviderConfig,
  kind: ModelKind,
  model: string,
): ModelWire | undefined {
  if (provider.type === 'opencode-go' || provider.type === 'opencode-zen') {
    if (kind === 'chat') return openCodeChatWire(provider.type, model);

    if (provider.type === 'opencode-zen' && kind === 'decision')
      return 'system-one';

    return undefined;
  }

  return VENDOR_DEFAULTS[provider.type]?.[kind];
}

/** Resolve once at boot; explicit wire selection still obeys kind and auth constraints. */
export function resolveModelWire(
  provider: ProviderConfig,
  model: { kind: ModelKind; modelId: string; wire?: ModelWire },
  path: string,
): ModelWire {
  const wire = model.wire ?? defaultWire(provider, model.kind, model.modelId);

  if (wire === undefined || !KIND_WIRES[model.kind].includes(wire)) {
    throw new InstanceConfigError(
      `${path}.wire: no supported ${model.kind} wire; declare an explicit wire`,
    );
  }

  if ((provider.type === 'openai-codex') !== (wire === 'openai-codex')) {
    throw new InstanceConfigError(
      `${path}.wire: the Codex transport requires an openai-codex account`,
    );
  }

  if (
    (provider.type === 'opencode-go' && model.kind !== 'chat') ||
    (provider.type === 'opencode-zen' &&
      model.kind !== 'chat' &&
      model.kind !== 'decision')
  ) {
    throw new InstanceConfigError(
      `${path}.wire: provider does not support ${model.kind} models`,
    );
  }

  if (wire === 'system-one' && !provider.key?.trim()) {
    throw new InstanceConfigError(
      `${path}.wire: decision requests require a nonblank provider key`,
    );
  }

  return wire;
}

/** API bases include the wire's version prefix; adapters append the operation. */
export function providerBaseUrl(provider: ProviderConfig): string {
  if (provider.type === 'openai-codex')
    return 'https://chatgpt.com/backend-api/codex';

  if (provider.type === 'opencode-go') return 'https://opencode.ai/zen/go/v1';

  if (provider.baseUrl !== null) return provider.baseUrl;

  switch (provider.type) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'opencode-zen':
      return 'https://opencode.ai/zen/v1';
    case 'anthropic':
    case 'anthropic-messages':
      return 'https://api.anthropic.com/v1';
    default:
      return 'https://api.openai.com/v1';
  }
}

/** Rank and embedding calls have no Chat identity; never invent one. */
export function nonChatHeaders(
  headers: RequestHeaderTemplates,
): RequestHeaderTemplates {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([, parts]) => parts.length === 1 && parts[0] !== '',
    ),
  );
}

export function decisionEndpoint(provider: ProviderConfig): string {
  const base = providerBaseUrl(provider).replace(/\/+$/u, '');

  if (provider.type !== 'openrouter') return `${base}/systemone`;

  const alpha = base.endsWith('/v1')
    ? `${base.slice(0, -3)}/alpha`
    : `${base}/alpha`;

  return `${alpha}/decisions`;
}
