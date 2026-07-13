/**
 * LlameConfig — the single typed shape of operator/system settings (SPEC
 * config-as-code, openspec/changes/instance-config). Produced once at boot by
 * `loadInstanceConfig` (config-loader.ts) and exposed read-only via
 * `InstanceConfigService`. Extend this type (and the published schema at
 * ./llame.config.schema.json, co-located here) together — they must never
 * drift.
 */

import type { SystemModelCatalogEntry } from '../models/model-catalog';

/**
 * Executable provider client implementations (providers-and-models-as-code,
 * #167). `openai` covers native OpenAI and any OpenAI-compatible endpoint
 * (Ollama, OpenRouter, a local server, ...). The Anthropic adapter is a
 * split-out follow-up: this enum is strict-closed on purpose — a schema that
 * advertised a `type` it cannot execute would fail at request time instead
 * of at the offending config path.
 */
export const PROVIDER_TYPES = ['openai'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/**
 * A configured provider connection: `type` selects the client
 * implementation, `key`/`baseUrl` are resolved (interpolated) values.
 * Providers are duplicable — two entries of the same `type` with distinct
 * `id`s and `baseUrl`s (e.g. hosted OpenAI + a local Ollama) coexist.
 * `key: null` means keyless (the resolved credential was empty/absent).
 */
export type ProviderConfig = {
  id: string;
  type: ProviderType;
  key: string | null;
  baseUrl: string | null;
};
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
   * entry for a profile name MERGES over the built-in profile of the same
   * name, per group (config-loader.ts's resolveWorkerProfiles) — tuning one
   * group's concurrency keeps that profile's other groups at their built-in
   * defaults. A profile name absent from the file is untouched; a genuinely
   * distinct subset of groups needs its own profile name.
   */
  workers: Record<string, WorkerProfile>;
  /**
   * Provider connections (providers-and-models-as-code, #167): duplicable
   * `{ id, type, key, baseUrl }` entries. Supersedes the `OPENAI_API_KEY` /
   * `OPENAI_BASE_URL` bare environment variables — those names remain valid
   * `{env:...}` interpolation inputs referenced from an entry's `key`/`baseUrl`.
   */
  providers: ProviderConfig[];
  /**
   * The executable model catalog (providers-and-models-as-code, #167),
   * superseding the formerly hardcoded `models/model-catalog.ts` array. Every
   * entry's `provider` must reference a `providers[].id` (boot-fail
   * otherwise, checked in config-loader.ts) — cross-array reference
   * integrity isn't expressible in the JSON Schema itself.
   */
  models: SystemModelCatalogEntry[];
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
  providers: [],
  models: [],
};
