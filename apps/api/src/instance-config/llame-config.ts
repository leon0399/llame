/**
 * LlameConfig — the single typed shape of operator/system settings (SPEC
 * config-as-code, openspec/changes/instance-config). Produced once at boot by
 * `loadInstanceConfig` (config-loader.ts) and exposed read-only via
 * `InstanceConfigService`. First-slice surface only (D7): shape-stable
 * scalars migrated from scattered env vars. Extend this type (and the
 * published schema at ./llame.config.schema.json, co-located here) together
 * — they must never drift.
 */
export type LlameConfig = {
  defaults: {
    modelId: string | null;
    titleGenerationModelId: string | null;
  };
  runs: {
    maxOutputTokens: number | null;
    /**
     * The job-queue's native worker-liveness window, in seconds
     * (durable-run-workers D7): applied as the `runs` queue's
     * `heartbeatSeconds` — while a run's job is in flight the worker
     * auto-signals liveness at half this interval, and the queue's monitor
     * fails+retries the job if the signal lapses this long. NOT an
     * application heartbeat interval (that mechanism, and the app-level
     * stale-heartbeat threshold it used to pair with, are deleted).
     */
    heartbeatSeconds: number;
    timeoutSeconds: number;
  };
  http: {
    trustProxy: string | null;
  };
  /**
   * Tool-calling loop availability (openspec/changes/tool-calling-loop, the
   * first consumer-driven schema extension per D3): the operator allowlist is
   * the ENTIRE availability story this slice — no policy engine exists yet.
   */
  tools: {
    /** Registered tool ids admitted for advertisement/execution. Default: empty (fail closed, no tools). */
    allowed: readonly string[];
    /** Hard step cap for the tool-calling loop. */
    maxStepsPerRun: number;
    /** Global per-tool-call timeout, in seconds (a tool may override at registration). */
    callTimeoutSeconds: number;
  };
};

/**
 * Built-in defaults (used when the file does not set a
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
    timeoutSeconds: 300,
  },
  http: {
    trustProxy: null,
  },
  tools: {
    allowed: [],
    maxStepsPerRun: 8,
    callTimeoutSeconds: 15,
  },
};
