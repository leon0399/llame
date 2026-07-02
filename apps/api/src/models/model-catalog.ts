/**
 * Known model metadata for the v0.1 static catalog — same shape of precedent as
 * MODEL_TOKEN_PRICES_USD_PER_1M in turn-telemetry.ts: a small map keyed by the
 * bare model id the client reports, covering the models we ship defaults for.
 * Arbitrary OpenAI-compatible endpoints (#88) can serve models we've never
 * heard of; those fall back to the MODEL_CONTEXT_WINDOW_TOKENS env override or
 * the conservative compaction default. A real per-provider catalog (models.dev
 * style) is a BYOK-era concern (#37).
 */
export const MODEL_CONTEXT_WINDOW_TOKENS_BY_MODEL: Record<string, number> = {
  'gpt-5.4-mini': 400_000,
  'gpt-4o-mini': 128_000,
};

export function contextWindowForModel(model: string): number | undefined {
  return MODEL_CONTEXT_WINDOW_TOKENS_BY_MODEL[model];
}
