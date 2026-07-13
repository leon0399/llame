/**
 * LlameConfig — the single typed shape of operator/system settings (SPEC
 * config-as-code, openspec/changes/instance-config). Produced once at boot by
 * `loadInstanceConfig` (config-loader.ts) and exposed read-only via
 * `InstanceConfigService`. First-slice surface only (D7): shape-stable
 * scalars migrated from scattered env vars. Extend this type (and the
 * published schema at ./llame.config.schema.json, co-located here) together
 * — they must never drift.
 */
/**
 * The fixed set of worker "consumer groups" a profile can reference — one per
 * consumer-owning service (durable-run-workers D2): `runs` (RunsWorkerService,
 * + its `runs.dead` DLQ), `search-reindex` (SearchReindexWorker, + the sweep
 * cron), `sessions-cleanup` (SessionCleanupService). Each group owns its main
 * queue AND whatever internal/control queues it needs at a fixed internal
 * concurrency; the operator only tunes the group's MAIN-queue concurrency via
 * the `workers` profile map below. Code-owned, not user-extensible — adding a
 * group (e.g. a future `embeddings` group, #196) is a code change here,
 * matched by a new service that gates itself on WorkerProfileService.
 */
export const WORKER_GROUPS = [
  'runs',
  'search-reindex',
  'sessions-cleanup',
] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

/** A worker profile: which groups a process consumes, and each one's main-queue concurrency. Absent group = not consumed by a process running this profile. */
export type WorkerProfile = Partial<Record<WorkerGroup, number>>;

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
   * Database connection pool (durable-run-workers): the per-process postgres
   * pool `max`. A run holds a connection for each `runAs` transaction, so this
   * MUST be >= the process's total run concurrency (sum of the active worker
   * profile's group concurrencies) plus HTTP-request headroom, and
   * `poolSize x replicas` must stay within Postgres `max_connections`. Applies
   * to both entrypoints (the co-located api and the dedicated worker).
   */
  db: {
    poolSize: number;
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
  /**
   * Worker profiles (durable-run-workers D2/D4): profile name → the groups it
   * consumes and each one's concurrency. Selected at boot by
   * `LLAME_WORKER_PROFILE` (default `all`) via WorkerProfileService. Built-in
   * `all` (every group, concurrency 1 — today's co-located behavior) and
   * `web` (no groups — an HTTP-only process) are always available; a file
   * entry for a profile name REPLACES that profile wholesale, other built-in
   * profiles are untouched.
   */
  workers: Record<string, WorkerProfile>;
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
  db: {
    poolSize: 10,
  },
  tools: {
    allowed: [],
    maxStepsPerRun: 8,
    callTimeoutSeconds: 15,
  },
  workers: {
    all: { runs: 1, 'search-reindex': 1, 'sessions-cleanup': 1 },
    web: {},
  },
};
