/**
 * Server-owned model catalog.
 *
 * Public ids are opaque llame ids. Provider execution ids are explicit
 * server-only configuration and must never be derived by parsing the public id.
 */

export const DEFAULT_SYSTEM_MODEL_ID = 'system:openai:gpt-5.4-mini';

export const ACTIVE_SYSTEM_MODEL_IDS = [
  'system:openai:gpt-5.5',
  'system:openai:gpt-5.4',
  'system:openai:gpt-5.4-mini',
  'system:openai:gpt-5.4-nano',
  'system:openai:gpt-4o',
  'system:openai:gpt-4o-mini',
] as const;

export type ActiveSystemModelId = (typeof ACTIVE_SYSTEM_MODEL_IDS)[number];
export type ModelSource = 'system';

export type TokenPrice = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
};

export type TokenPriceMap = Record<string, TokenPrice>;

export type ModelPricingUsdPer1M = {
  input?: number;
  cachedInput?: number;
  output?: number;
};

export interface PublicModelCatalogEntry {
  id: ActiveSystemModelId;
  source: ModelSource;
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  // Required, execution-critical (not display metadata): every executable model
  // MUST declare its context window. It travels onto the model client and sizes
  // the context-compaction trigger (× COMPACTION_WINDOW_RATIO); without it, long
  // chats on a small-window model would overflow before compaction ever fires.
  contextWindowTokens: number;
  pricingUsdPer1M?: ModelPricingUsdPer1M;
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
}

export interface SystemModelCatalogEntry extends PublicModelCatalogEntry {
  provider: 'openai';
  providerModelId: string;
}

export const SYSTEM_MODEL_CATALOG = [
  {
    id: 'system:openai:gpt-5.5',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Most capable system OpenAI-compatible model.',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: {
      input: 2.5,
      cachedInput: 0.25,
      output: 10,
    },
    reasoning: true,
    website: 'https://openai.com',
  },
  {
    id: 'system:openai:gpt-5.4',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'High-capability system OpenAI-compatible model.',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: {
      input: 1.25,
      cachedInput: 0.125,
      output: 7.5,
    },
    reasoning: true,
    website: 'https://openai.com',
  },
  {
    id: 'system:openai:gpt-5.4-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    description: 'Balanced default system OpenAI-compatible model.',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: {
      input: 0.75,
      cachedInput: 0.075,
      output: 4.5,
    },
    reasoning: true,
    website: 'https://openai.com',
  },
  {
    id: 'system:openai:gpt-5.4-nano',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    description: 'Small system OpenAI-compatible model for internal work.',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: {
      input: 0.1,
      cachedInput: 0.01,
      output: 0.4,
    },
    website: 'https://openai.com',
  },
  {
    id: 'system:openai:gpt-4o',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Fast, intelligent, flexible GPT model.',
    contextWindowTokens: 128_000,
    pricingUsdPer1M: {
      input: 2.5,
      output: 10,
    },
    knowledgeCutoff: '2023-10-01',
    website: 'https://openai.com',
    apiDocs: 'https://platform.openai.com/docs/models/gpt-4o',
    modelPage: 'https://platform.openai.com/docs/models/gpt-4o',
    releasedAt: '2024-08-06',
  },
  {
    id: 'system:openai:gpt-4o-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextWindowTokens: 128_000,
    pricingUsdPer1M: {
      input: 0.15,
      cachedInput: 0.075,
      output: 0.6,
    },
    website: 'https://openai.com',
    apiDocs: 'https://platform.openai.com/docs/models/gpt-4o-mini',
    modelPage: 'https://platform.openai.com/docs/models/gpt-4o-mini',
  },
] as const satisfies readonly SystemModelCatalogEntry[];

export const SYSTEM_MODEL_BY_ID = new Map<
  ActiveSystemModelId,
  SystemModelCatalogEntry
>(SYSTEM_MODEL_CATALOG.map((model) => [model.id, model]));

export const PUBLIC_SYSTEM_MODELS: PublicModelCatalogEntry[] =
  SYSTEM_MODEL_CATALOG.map(toPublicModel);

function toPublicModel(
  model: SystemModelCatalogEntry,
): PublicModelCatalogEntry {
  return {
    id: model.id,
    source: model.source,
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(model.description !== undefined
      ? { description: model.description }
      : {}),
    ...(model.tags !== undefined ? { tags: model.tags } : {}),
    ...(model.icon !== undefined ? { icon: model.icon } : {}),
    contextWindowTokens: model.contextWindowTokens,
    ...(model.pricingUsdPer1M !== undefined
      ? { pricingUsdPer1M: model.pricingUsdPer1M }
      : {}),
    ...(model.knowledgeCutoff !== undefined
      ? { knowledgeCutoff: model.knowledgeCutoff }
      : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.website !== undefined ? { website: model.website } : {}),
    ...(model.apiDocs !== undefined ? { apiDocs: model.apiDocs } : {}),
    ...(model.modelPage !== undefined ? { modelPage: model.modelPage } : {}),
    ...(model.releasedAt !== undefined ? { releasedAt: model.releasedAt } : {}),
  };
}

/** Pricing view of the catalog, keyed by opaque llame model id. */
export const MODEL_TOKEN_PRICES_USD_PER_1M: TokenPriceMap = Object.fromEntries(
  SYSTEM_MODEL_CATALOG.flatMap((model) => {
    const price: ModelPricingUsdPer1M | undefined = model.pricingUsdPer1M;
    if (price?.input === undefined || price.output === undefined) {
      return [];
    }

    return [
      [
        model.id,
        {
          inputUsdPer1M: price.input,
          ...(price.cachedInput !== undefined
            ? { cachedInputUsdPer1M: price.cachedInput }
            : {}),
          outputUsdPer1M: price.output,
        },
      ],
    ];
  }),
);

// Future provider entries, intentionally commented out so they are not exported
// or returned by /api/v1/models until execution support exists.
//
// {
//   id: 'system:anthropic:claude-4-opus',
//   source: 'system',
//   provider: 'anthropic',
//   providerModelId: 'claude-4-opus',
//   name: 'Claude 4 Opus',
//   contextWindowTokens: 200_000,
//   pricingUsdPer1M: {
//     input: 15,
//     output: 75,
//   },
//   website: 'https://www.anthropic.com',
//   apiDocs: 'https://docs.anthropic.com',
//   modelPage: 'https://www.anthropic.com/news/claude-4',
// }
//
// {
//   id: 'system:anthropic:claude-4-sonnet',
//   source: 'system',
//   provider: 'anthropic',
//   providerModelId: 'claude-4-sonnet',
//   name: 'Claude 4 Sonnet',
//   contextWindowTokens: 200_000,
//   pricingUsdPer1M: {
//     input: 3,
//     output: 15,
//   },
//   website: 'https://www.anthropic.com',
//   apiDocs: 'https://docs.anthropic.com',
//   modelPage: 'https://www.anthropic.com/news/claude-4',
// }
//
// {
//   id: 'system:xai:grok-3-mini',
//   source: 'system',
//   provider: 'xai',
//   providerModelId: 'grok-3-mini',
//   name: 'Grok 3 Mini',
// }
//
// {
//   id: 'system:xai:grok-3-mini-fast',
//   source: 'system',
//   provider: 'xai',
//   providerModelId: 'grok-3-mini-fast',
//   name: 'Grok 3 Mini Fast',
// }
