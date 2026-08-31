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

/** Resolved private Streamable HTTP server configuration. */
export type McpRemoteServerConfig = {
  type: 'streamable-http';
  url: string;
  headers?: Readonly<Record<string, string>>;
};

/**
 * Resolved local stdio server configuration.
 *
 * `protectedValues` holds what the entry's `{env:…}` / `{path:…}` tokens
 * resolved to, across `command`, `args`, and `env`. Literal configuration text
 * is deliberately absent: protected values are substring-matched across tool
 * traffic, so protecting a low-entropy literal such as a root directory would
 * refuse legitimate calls and corrupt legitimate results.
 */
export type McpStdioServerConfig = {
  type: 'stdio';
  command: string;
  args?: ReadonlyArray<string>;
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  protectedValues?: ReadonlyArray<string>;
};

export type McpServerConfig = McpRemoteServerConfig | McpStdioServerConfig;
/**
 * The fixed set of worker "consumer groups" a profile can reference — one per
 * consumer-owning service (durable-run-workers D2): `runs` (RunsWorkerService,
 * + its `runs.dead` DLQ), `search-reindex` (SearchReindexWorker, + the sweep
 * cron), `sessions-cleanup` (SessionCleanupService), `search-embed`
 * (SearchEmbedWorker — chat-search-embeddings design D14; a SEPARATE group
 * from `search-reindex` because it is network-bound and latency-tolerant
 * where reindexing is DB-bound and latency-sensitive, and because its
 * concurrency is the operator's provider-spend/self-hosted-saturation dial).
 * Each group owns its main queue AND whatever internal/control queues it
 * needs at a fixed internal concurrency; the operator only tunes the group's
 * MAIN-queue concurrency via the `workers` profile map below. Code-owned, not
 * user-extensible — adding a group is a code change here, matched by a new
 * service that gates itself on WorkerProfileService.
 */
export const WORKER_GROUPS = [
  'runs',
  'search-reindex',
  'sessions-cleanup',
  'search-embed',
] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

/** A worker profile: which groups a process consumes, and each one's main-queue concurrency. Absent group = not consumed by a process running this profile. */
export type WorkerProfile = Partial<Record<WorkerGroup, number>>;

/** Unresolved operator-owned Knowledge settings. */
export type RawKnowledgeConfig = {
  root?: unknown;
};

/** Resolved operator-owned Knowledge settings. */
export type KnowledgeConfig = {
  root?: string;
};

/**
 * The still-uninterpolated `mcpServers` entry shape once the published JSON
 * Schema has validated it (config-loader.ts's `assertValidRaw`) — scalar
 * fields still need `{env:}`/`{path:}` resolution before they become a
 * `McpServerConfig`.
 */
export type RawMcpServerEntry =
  | {
      type: 'http' | 'streamable-http';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'stdio';
      command: string;
      args?: Array<string>;
      env?: Record<string, string>;
      cwd?: string;
    };

/** The still-uninterpolated `providers[]` entry shape once schema-validated. */
export type RawProviderEntry = {
  id: string;
  type: ProviderType;
  key?: unknown;
  baseUrl?: unknown;
};

/**
 * Distance metric a declared embedding model produces (chat-search-embeddings
 * design D12). Cosine is the default and, in this change, the ONLY metric any
 * adapter produces — closed on purpose so a config naming an unimplemented
 * metric fails validation, not execution (same posture as `ProviderType`).
 */
export const EMBEDDING_DISTANCE_METRICS = ['cosine'] as const;
export type EmbeddingDistanceMetric =
  (typeof EMBEDDING_DISTANCE_METRICS)[number];

/** Default request batch size when an `embeddingModels[]` entry omits `batchSize` (design D5). */
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

/** The still-uninterpolated `embeddingModels[]` entry shape once schema-validated. */
export type RawEmbeddingModelEntry = {
  id: string;
  provider: string;
  providerModelId: string;
  dimensions: number;
  batchSize?: number;
  distanceMetric?: EmbeddingDistanceMetric;
  revision?: string;
  documentPrefix?: string;
  queryPrefix?: string;
};

/**
 * A resolved embedding-model catalog entry (chat-search-embeddings design
 * D1/D8). References a `providers[].id`, reusing that connection rather than
 * introducing a parallel credential/endpoint concept. `providerModelId` is
 * server-only and MUST NOT leak past the backend adapter into stored rows,
 * application interfaces, logs, or any user- or model-visible surface.
 */
export type EmbeddingModelCatalogEntry = {
  id: string;
  provider: string;
  providerModelId: string;
  dimensions: number;
  /** Always resolved (defaults to `DEFAULT_EMBEDDING_BATCH_SIZE`) — NOT part of the binding-ledger comparison set; a throughput knob, not part of the embedding space. */
  batchSize: number;
  /** Always resolved (defaults to `'cosine'`). */
  distanceMetric: EmbeddingDistanceMetric;
  revision?: string;
  documentPrefix?: string;
  queryPrefix?: string;
};

/**
 * The still-uninterpolated `search` block once schema-validated. `chats` is
 * the only corpus this change embeds; a later corpus (knowledge/RAG, curated
 * memory) adds its own key here, not a new shape.
 */
export interface RawSearchConfig extends Record<string, unknown> {
  chats?: {
    embeddingModelId?: unknown;
  };
}

/**
 * Per-corpus intended-embedding-model selection (chat-search-embeddings
 * design D6): naming an `embeddingModels[].id` per corpus rather than one
 * instance-wide flag, so corpora embedding at different rates cannot strand
 * one another. `embeddingModelId: null` (unset, the default) means the
 * corpus has no intended model and produces no embedding work — part of the
 * off-by-default contract.
 */
export type SearchCorpusConfig = {
  embeddingModelId: string | null;
};

/** The still-uninterpolated `models[]` entry shape once schema-validated. */
export type RawModelEntry = {
  id: string;
  provider: string;
  providerModelId: string;
  contextWindowTokens: unknown;
  compactionThresholdTokens?: unknown;
  systemPromptFile?: string;
  pricingUsdPer1M?: SystemModelCatalogEntry['pricingUsdPer1M'];
  name?: string;
  description?: string;
  tags?: Array<string>;
  icon?: string;
  knowledgeCutoff?: string;
  /**
   * The shape an operator WRITES, declared plainly rather than derived from the
   * resolved `ModelReasoning`: the two are deliberately independent, since a
   * resolved-only computed field would have no business in the config file.
   * Items may be bare strings or `{ value, label }` objects. `defaultEffort`'s
   * membership in `effortLevels[].value` and value uniqueness are cross-field
   * rules JSON Schema can't express, so `resolveModels` owns them, and
   * `cacheInvalidatedByEffortChange` is optional here but always resolved on
   * the catalog entry.
   */
  reasoning?: {
    readonly effortLevels: ReadonlyArray<
      string | { readonly value: string; readonly label: string }
    >;
    readonly defaultEffort: string;
    readonly cacheInvalidatedByEffortChange?: boolean;
  };
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
};

/**
 * The raw config document's shape once `assertValidRaw` (config-loader.ts)
 * has run the closed published JSON Schema over it — the composite fields
 * below are what the schema guarantees about their element/entry shape, not
 * a re-derivation of it. Scalar leaves stay `unknown`: `readLeaf` derives
 * per-group-and-key presence generically, and each resolver narrows its own
 * leaf with its own runtime check. Extending `Record<string, unknown>` keeps
 * this assignable everywhere a plain parsed-JSON record is still expected.
 */
export interface RawInstanceConfig extends Record<string, unknown> {
  mcpServers?: Record<string, RawMcpServerEntry>;
  knowledge?: RawKnowledgeConfig;
  workers?: Record<string, WorkerProfile>;
  providers?: Array<RawProviderEntry>;
  models?: Array<RawModelEntry>;
  embeddingModels?: Array<RawEmbeddingModelEntry>;
  search?: RawSearchConfig;
}

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
    /** Code-owned ids or exact / canonical configured-MCP namespace permissions admitted for advertisement/execution. Default: empty. */
    allowed: ReadonlyArray<string>;
    /** Hard step cap for the tool-calling loop. */
    maxStepsPerRun: number;
    /** Global per-tool-call timeout, in seconds (a tool may override at registration). */
    callTimeoutSeconds: number;
  };
  /** Operator-managed remote Streamable HTTP servers. Default: empty. */
  mcpServers: Readonly<Record<string, McpServerConfig>>;
  /** Optional process-local root for trusted Knowledge Space directories. */
  knowledge: KnowledgeConfig;
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
  providers: Array<ProviderConfig>;
  /**
   * The executable model catalog (providers-and-models-as-code, #167),
   * superseding the formerly hardcoded `models/model-catalog.ts` array. Every
   * entry's `provider` must reference a `providers[].id` (boot-fail
   * otherwise, checked in config-loader.ts) — cross-array reference
   * integrity isn't expressible in the JSON Schema itself.
   */
  models: Array<SystemModelCatalogEntry>;
  /**
   * The declared embedding-model catalog (chat-search-embeddings, design
   * D1). Default: empty — an instance declaring none is unchanged from
   * today (off-by-default; part of the exit contract).
   */
  embeddingModels: Array<EmbeddingModelCatalogEntry>;
  /**
   * Per-corpus search settings (chat-search-embeddings, design D6). `chats`
   * is the only corpus this change embeds.
   */
  search: {
    chats: SearchCorpusConfig;
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
  db: {
    poolSize: 10,
  },
  tools: {
    allowed: [],
    maxStepsPerRun: 8,
    callTimeoutSeconds: 15,
  },
  mcpServers: {},
  knowledge: {},
  workers: {
    all: {
      runs: 1,
      'search-reindex': 1,
      'sessions-cleanup': 1,
      'search-embed': 1,
    },
    web: {},
  },
  providers: [],
  models: [],
  embeddingModels: [],
  search: {
    chats: { embeddingModelId: null },
  },
};
