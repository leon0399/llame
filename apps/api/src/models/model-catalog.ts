/**
 * The v0.1 static model catalog — the single source of per-model facts (context
 * window, token pricing), keyed by the bare model id the client reports. One
 * entry per known model, so adding a model is one edit and the facts can't
 * drift apart across files.
 *
 * Arbitrary OpenAI-compatible endpoints (#88) can serve models this catalog has
 * never heard of; consumers fall back per-field (compaction: the
 * MODEL_CONTEXT_WINDOW_TOKENS env override or a conservative default; cost
 * telemetry: null). A real per-provider catalog (models.dev style) is a
 * BYOK-era concern (#37).
 */

export type TokenPrice = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
};

export type TokenPriceMap = Record<string, TokenPrice>;

export interface ModelCatalogEntry {
  contextWindowTokens?: number;
  tokenPricesUsdPer1M?: TokenPrice;
}

export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  'gpt-5.4-mini': {
    contextWindowTokens: 400_000,
    tokenPricesUsdPer1M: {
      inputUsdPer1M: 0.75,
      cachedInputUsdPer1M: 0.075,
      outputUsdPer1M: 4.5,
    },
  },
  'gpt-4o-mini': {
    contextWindowTokens: 128_000,
    tokenPricesUsdPer1M: {
      inputUsdPer1M: 0.15,
      cachedInputUsdPer1M: 0.075,
      outputUsdPer1M: 0.6,
    },
  },
};

export function contextWindowForModel(model: string): number | undefined {
  return MODEL_CATALOG[model]?.contextWindowTokens;
}

/** Pricing view of the catalog, in the map shape cost calculation consumes. */
export const MODEL_TOKEN_PRICES_USD_PER_1M: TokenPriceMap = Object.fromEntries(
  Object.entries(MODEL_CATALOG).flatMap(([model, entry]) =>
    entry.tokenPricesUsdPer1M ? [[model, entry.tokenPricesUsdPer1M]] : [],
  ),
);
