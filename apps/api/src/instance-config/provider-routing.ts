import { InstanceConfigError } from '@workspace/config-interpolation';
import type { ProviderConfig } from './llame-config';
import type { RequestHeaderTemplates } from '../models/request-headers';
import type { BillingMode } from '../models/model-client';
import modelMetadata from './provider-model-wires.json';

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
  | 'openrouter-decisions'
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
  decision: ['system-one', 'openrouter-decisions'],
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
    decision: 'openrouter-decisions',
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

// The importer normalizes exact provider/model entries to llame wire names.
// TODO(#1741): Enable null Google entries after the native adapter ships.
const OPEN_CODE_MODELS: Record<
  string,
  Readonly<Record<string, string | null>>
> = modelMetadata.providers;

function openCodeChatWire(type: string, model: string): ModelWire | undefined {
  const models = OPEN_CODE_MODELS[type];

  const wire =
    models && Object.hasOwn(models, model) ? models[model] : undefined;

  switch (wire) {
    case 'anthropic-messages':
    case 'openai-responses':
    case 'openai-completions':
      return wire;
    default:
      return undefined;
  }
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

  if (model.kind === 'decision' && !provider.key?.trim()) {
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

/**
 * The resolved decision wire picks the path; the account only supplies the
 * base. An absent wire takes the account's decision default.
 */
export function decisionEndpoint(
  provider: ProviderConfig,
  wire: ModelWire | undefined,
): string {
  const base = providerBaseUrl(provider).replace(/\/+$/u, '');
  const resolved = wire ?? defaultWire(provider, 'decision', '');

  if (resolved !== 'openrouter-decisions') return `${base}/systemone`;

  const alpha = base.endsWith('/v1')
    ? `${base.slice(0, -3)}/alpha`
    : `${base}/alpha`;

  return `${alpha}/decisions`;
}
