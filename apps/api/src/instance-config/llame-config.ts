/**
 * LlameConfig — the single typed shape of operator/system settings (SPEC
 * config-as-code, openspec/changes/instance-config). Produced once at boot by
 * `loadInstanceConfig` (config-loader.ts) and exposed read-only via
 * `InstanceConfigService`. First-slice surface only (D7): shape-stable
 * scalars migrated from scattered env vars. Extend this type (and the
 * published schema at ../../llame.config.schema.json) together — they must
 * never drift.
 */
export type LlameConfig = {
  defaults: {
    modelId: string | null;
    titleGenerationModelId: string | null;
  };
  runs: {
    maxOutputTokens: number | null;
    heartbeatSeconds: number;
    heartbeatStaleSeconds: number;
    timeoutSeconds: number;
  };
  http: {
    trustProxy: string | null;
  };
};

/**
 * Built-in defaults (used when neither the file nor the legacy env var sets a
 * key) — the current documented defaults for the migrated run timers.
 */
export const BUILT_IN_DEFAULTS: LlameConfig = {
  defaults: {
    modelId: null,
    titleGenerationModelId: null,
  },
  runs: {
    maxOutputTokens: null,
    heartbeatSeconds: 15,
    heartbeatStaleSeconds: 60,
    timeoutSeconds: 300,
  },
  http: {
    trustProxy: null,
  },
};
