/**
 * LlameConfig — the single typed shape of operator/system settings (SPEC
 * config-as-code, openspec/changes/instance-config). Produced once at boot by
 * `loadInstanceConfig` (config-loader.ts) and exposed read-only via
 * `InstanceConfigService`. Extend this type (and the published schema at
 * ./llame.config.schema.json, co-located here) together — they must never
 * drift.
 */

import type { BillingMode } from '../models/model-client';
import type { RequestHeaderTemplates } from '../models/request-headers';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { type ToolPermissionMap } from '../tools/permissions/types';
import type { PermissionMode } from '../tools/permissions/permission-mode';

/**
 * Executable provider client implementations (providers-and-models-as-code,
 * #167). `type` names the wire API the entry speaks — never inferred from
 * the `id`, the `baseUrl`, or a host: `openai-responses` executes the
 * Responses API through `@ai-sdk/openai` (hosted OpenAI or any compatible
 * `/v1/responses` server); `openai-completions` executes the Chat
 * Completions API through `@ai-sdk/openai-compatible` at its required
 * `baseUrl`; `anthropic-messages` executes the Messages API through
 * `@ai-sdk/anthropic` at its optional `baseUrl` (the Anthropic API by
 * default, a Messages-speaking gateway when configured); `openai-codex`
 * uses the personal Codex subscription backend; `opencode-go` executes the
 * Chat Completions wire against the OpenCode Go subscription gateway, at a
 * destination fixed in llame's code, from a required `key` and no endpoint
 * field of its own.
 * This set is strict-closed on purpose — a schema that advertised a `type`
 * it cannot execute would fail at request time instead of at the offending
 * config path.
 */
/**
 * A configured provider connection: `type` selects the client
 * implementation, `key`/`baseUrl` are resolved (interpolated) values.
 * Providers are duplicable — two entries of the same `type` with distinct
 * `id`s and `baseUrl`s (e.g. hosted OpenAI + a local Ollama) coexist.
 * `key: null` means keyless (the resolved credential was empty/absent).
 */
export type OpenAIResponsesProviderConfig = {
  id: string;
  type: 'openai-responses';
  billing?: BillingMode;
  key: string | null;
  /** `null` uses the client's own default (OpenAI's hosted API). */
  baseUrl: string | null;
  headers: RequestHeaderTemplates;
};

/**
 * Chat Completions wire through `@ai-sdk/openai-compatible`. Unlike the
 * Responses wire, `baseUrl` is required: the adapter has no default
 * endpoint, so an entry that omits it (or resolves it to empty) fails at
 * boot, naming the entry and the field.
 */
export type OpenAICompletionsProviderConfig = {
  id: string;
  type: 'openai-completions';
  billing?: BillingMode;
  key: string | null;
  baseUrl: string;
  headers: RequestHeaderTemplates;
};

/**
 * Messages wire through `@ai-sdk/anthropic`. Like the Responses wire,
 * `baseUrl` is optional: `null` uses the client's own default (the
 * Anthropic API), while a configured value targets any Messages-speaking
 * gateway exactly as authored (anthropic-provider D1/D3).
 */
export type AnthropicMessagesProviderConfig = {
  id: string;
  billing?: BillingMode;
  type: 'anthropic-messages';
  key: string | null;
  /** `null` uses the client's own default (the Anthropic API). */
  baseUrl: string | null;
  headers: RequestHeaderTemplates;
};

export type OpenAICodexProviderConfig = {
  id: string;
  type: 'openai-codex';
  billing?: BillingMode;
  key: string;
  accountId: string;
  headers: RequestHeaderTemplates;
};

/**
 * OpenCode Go subscription gateway (opencode-go-provider D1). The entry is
 * key-only by construction: the destination is a constant in llame's code
 * (`OPENCODE_GO_BASE_URL`, models/opencode-go-model-client.ts), so there is no
 * `baseUrl` field to resolve or store and no ambient variable that can move a
 * request. The gateway authenticates every request, so `key` is schema-required
 * and must resolve nonblank — unlike the other wire types, a Go entry never
 * loads keyless.
 */
export type OpenCodeGoProviderConfig = {
  id: string;
  billing?: BillingMode;
  type: 'opencode-go';
  key: string;
  headers: RequestHeaderTemplates;
};

export type ProviderConfig =
  | OpenAIResponsesProviderConfig
  | OpenAICompletionsProviderConfig
  | AnthropicMessagesProviderConfig
  | OpenAICodexProviderConfig
  | OpenCodeGoProviderConfig;

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

/** The still-uninterpolated `webSearch` engine entry once schema-validated. */
export type RawWebSearchEngineEntry =
  | {
      id: string;
      type: 'brave' | 'exa' | 'perplexity';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'searxng';
      /** Required operator-controlled SearXNG base URL before interpolation. */
      baseUrl: string;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'exa-mcp';
      /** Optional Exa credential; interpolation may still resolve blank. */
      key?: string | null;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'duckduckgo';
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'model-hosted';
      /** A `models[].id`, resolved against the model catalog at startup. */
      model: string;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'aggregate';
      engines: Array<string>;
    };

/** The still-uninterpolated operator `webSearch` section. */
export type RawWebSearchConfig = {
  engines: Array<RawWebSearchEngineEntry>;
  chain: Array<string>;
};

export type WebSearchEngineConfig =
  | ({
      id: string;
      /** Per-attempt deadline in seconds (default 60). */
      timeoutSeconds: number;
    } & (
      | {
          type: 'brave' | 'exa' | 'perplexity';
          /** Interpolated vendor credential; never surfaced in output or errors. */
          key: string;
        }
      | {
          type: 'searxng';
          /** Absolute http(s) base URL of the operator's SearXNG instance. */
          baseUrl: string;
        }
      | {
          type: 'exa-mcp';
          /** Optional Exa key sent to the hosted MCP endpoint to raise its limits. */
          key: string | undefined;
        }
      | { type: 'duckduckgo' }
      | {
          type: 'model-hosted';
          /** A `models[].id` on an `openai-responses`, `openai-codex`, or `anthropic-messages` provider. */
          model: string;
          /** That model's provider type, resolved at startup. */
          wire: 'openai-responses' | 'openai-codex' | 'anthropic-messages';
        }
    ))
  | {
      id: string;
      type: 'aggregate';
      /** Two or more distinct result-engine ids run concurrently and merged. */
      engines: ReadonlyArray<string>;
    };

/** Resolved operator `webSearch` section: engines and the ordered chain of their ids. */
export type WebSearchConfig = {
  engines: ReadonlyArray<WebSearchEngineConfig>;
  chain: ReadonlyArray<string>;
};

/**
 * Unresolved operator-owned skill source settings (system-provided-skills D1).
 * `directories` stays `unknown` until its own resolver narrows the leaf:
 * these are literal public filesystem paths, not interpolated strings.
 */
export type RawSkillsConfig = {
  directories?: unknown;
};

/** Resolved operator-owned skill source settings: ordered, absolute directory paths. */
export type SkillsConfig = {
  directories: ReadonlyArray<string>;
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
export type RawProviderEntry =
  | {
      id: string;
      type: 'openai-responses';
      billing?: BillingMode;
      key?: unknown;
      baseUrl?: unknown;
      headers?: Record<string, string | null>;
    }
  | {
      id: string;
      type: 'openai-completions';
      billing?: BillingMode;
      key?: unknown;
      /** Schema-required for this branch; may still be `null`/blank after interpolation. */
      baseUrl: string | null;
      headers?: Record<string, string | null>;
    }
  | {
      id: string;
      type: 'anthropic-messages';
      billing?: BillingMode;
      key?: unknown;
      baseUrl?: unknown;
      headers?: Record<string, string | null>;
    }
  | {
      id: string;
      type: 'openai-codex';
      billing?: BillingMode;
      key: string | null;
      accountId: string | null;
      headers?: Record<string, string | null>;
    }
  | {
      id: string;
      type: 'opencode-go';
      billing?: BillingMode;
      /** Schema-required for this branch; may still be `null`/blank after interpolation. */
      key: string | null;
      headers?: Record<string, string | null>;
    };

/**
 * Distance metric a declared embedding model produces (chat-search-embeddings
 * design D12). Cosine is the default and, in this change, the ONLY metric any
 * adapter produces — closed on purpose so a config naming an unimplemented
 * metric fails validation, not execution (the same posture as the provider union).
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
  billing?: BillingMode;
  providerModelId: string;
  contextWindowTokens: unknown;
  compactionThresholdTokens?: unknown;
  /**
   * Per-model output-token limit (anthropic-provider D6): still unresolved —
   * a literal positive integer or a whole-value `{env:}`/`{path:}` token,
   * resolved and re-bounded after interpolation exactly like
   * `contextWindowTokens`.
   */
  maxOutputTokens?: unknown;
  /**
   * The operator's provider-native request options for the adapter this
   * entry's provider `type` selects. Stays `unknown` because the loader proves
   * it itself: it must be a JSON record at every depth, any `{env:…}`/
   * `{path:…}` syntax in a string value at any depth is rejected, and it is
   * otherwise retained verbatim (providers-and-models-as-code; the published
   * schema declares it as a typed free-form object).
   */
  providerOptions?: unknown;
  systemPromptFile?: string;
  /** Per-tool description file overrides for this model. Keys are registered llame-owned tool IDs; null falls through. */
  toolPromptFiles?: Readonly<Record<string, string | null>>;
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
/** The still-uninterpolated web adapter entry once schema-validated. */
export type RawWebAdapterEntry =
  | {
      id: string;
      use: 'rewrite';
      hosts: Array<string>;
      pathPattern?: string;
      target: string;
    }
  | {
      id: string;
      use: 'github';
      token?: string;
    }
  | {
      id: string;
      use: 'bluesky';
    }
  | {
      id: string;
      use: 'npm';
    }
  | {
      id: string;
      use: 'huggingface';
    }
  | {
      id: string;
      use: 'arxiv';
    }
  | {
      id: string;
      use: 'stackexchange';
    }
  | {
      id: string;
      use: 'crates';
    }
  | {
      id: string;
      use: 'hackernews';
    }
  | {
      id: string;
      use: 'doi';
    }
  | {
      id: string;
      use: 'discourse';
      hosts: Array<string>;
    }
  | {
      id: string;
      use: 'devto' | 'substack' | 'osv' | 'wikipedia';
    };

/** Schema-validated composite fields consumed from the raw tools block. */
export type RawToolsConfig = {
  webAdapters?: Array<RawWebAdapterEntry>;
};

export interface RawInstanceConfig extends Record<string, unknown> {
  tools?: RawToolsConfig;
  mcpServers?: Record<string, RawMcpServerEntry>;
  knowledge?: RawKnowledgeConfig;
  skills?: RawSkillsConfig;
  workers?: Record<string, WorkerProfile>;
  providers?: Array<RawProviderEntry>;
  models?: Array<RawModelEntry>;
  embeddingModels?: Array<RawEmbeddingModelEntry>;
  search?: RawSearchConfig;
  webSearch?: RawWebSearchConfig;
}

export type RewriteWebAdapterConfig = {
  readonly id: string;
  readonly use: 'rewrite';
  /** Exact canonical hostnames (lowercase, no port). */
  readonly hosts: ReadonlyArray<string>;
  /** Optional RE2-compatible regex matched against the canonical path. */
  readonly pathPattern?: string;
  /** Literal http(s) origin + path/query template; `{path}` and `{query}` only. */
  readonly target: string;
};

export type GithubWebAdapterConfig = {
  readonly id: string;
  readonly use: 'github';
  readonly token?: string;
};

export type BlueskyWebAdapterConfig = {
  readonly id: string;
  readonly use: 'bluesky';
};

export type NpmWebAdapterConfig = {
  readonly id: string;
  readonly use: 'npm';
};

export type HuggingfaceWebAdapterConfig = {
  readonly id: string;
  readonly use: 'huggingface';
};

export type ArxivWebAdapterConfig = {
  readonly id: string;
  readonly use: 'arxiv';
};

export type StackexchangeWebAdapterConfig = {
  readonly id: string;
  readonly use: 'stackexchange';
};

export type CratesWebAdapterConfig = {
  readonly id: string;
  readonly use: 'crates';
};

export type HackernewsWebAdapterConfig = {
  readonly id: string;
  readonly use: 'hackernews';
};

export type DoiWebAdapterConfig = {
  readonly id: string;
  readonly use: 'doi';
};

/** Discourse runs on any host, so the operator lists the forums by exact
 *  canonical hostname (lowercase, no port). */
export type DiscourseWebAdapterConfig = {
  readonly id: string;
  readonly use: 'discourse';
  readonly hosts: ReadonlyArray<string>;
};

/** A native adapter entry that takes no field beyond its id. */
type FieldlessWebAdapterConfig<Use extends string> = {
  readonly id: string;
  readonly use: Use;
};

export type DevtoWebAdapterConfig = FieldlessWebAdapterConfig<'devto'>;
export type SubstackWebAdapterConfig = FieldlessWebAdapterConfig<'substack'>;
export type OsvWebAdapterConfig = FieldlessWebAdapterConfig<'osv'>;
export type WikipediaWebAdapterConfig = FieldlessWebAdapterConfig<'wikipedia'>;

export type WebAdapterConfig =
  | RewriteWebAdapterConfig
  | GithubWebAdapterConfig
  | BlueskyWebAdapterConfig
  | NpmWebAdapterConfig
  | HuggingfaceWebAdapterConfig
  | ArxivWebAdapterConfig
  | StackexchangeWebAdapterConfig
  | CratesWebAdapterConfig
  | HackernewsWebAdapterConfig
  | DoiWebAdapterConfig
  | DiscourseWebAdapterConfig
  | DevtoWebAdapterConfig
  | SubstackWebAdapterConfig
  | OsvWebAdapterConfig
  | WikipediaWebAdapterConfig;

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
    /**
     * The operator's opt-in in-process wall-clock budget, in seconds. `null`
     * (the built-in default) means NO budget: a progressing Run is never
     * ended by age. A configured value must be a positive integer below
     * `RUN_EXECUTION_CEILING_SECONDS` (the runs domain's execution ceiling),
     * which the loader enforces so a budget the ceiling would silently
     * truncate cannot be configured.
     */
    timeoutSeconds: number | null;
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
    /** Stable trusted alpha host identity; absent means native tools are unavailable. */
    nativeExecutorId?: string;
    /** Code-owned ids or exact / canonical configured-MCP namespace permissions admitted for advertisement/execution. Default: empty. */
    allowed: ReadonlyArray<string>;
    /**
     * Operator allow/reject rules keyed by exact tool identity. There is no
     * built-in policy: omitting `tools.permissions` from the file leaves the
     * map empty, so every call is rejected; `llame.config.jsonc.example` ships
     * a recommended portable map to copy. Availability is governed separately
     * by `allowed`; permission rules never change tool visibility.
     */
    permissions: ToolPermissionMap;
    /**
     * Ordered list of per-Run permission modes the operator enables. Default:
     * `['default']`; enabling `bypass` lets a Run skip every
     * `tools.permissions` evaluation instance-wide.
     */
    permissionModes: ReadonlyArray<PermissionMode>;
    /**
     * Hard step cap for the tool-calling loop. `null` (the built-in default)
     * means no cap — the loop lets the model take as many steps as it asks
     * for.
     */
    maxStepsPerRun: number | null;
    /** Global per-tool-call timeout, in seconds (a tool may override at registration). */
    callTimeoutSeconds: number;
    /** Instance-wide tool description file overrides. Keys are registered llame-owned tool IDs; null falls through to packaged defaults. */
    promptFiles?: Readonly<Record<string, string | null>>;
    /** Ordered operator-configured web adapters. Absent means no adapters. */
    webAdapters: ReadonlyArray<WebAdapterConfig>;
  };
  /** Operator-managed remote Streamable HTTP servers. Default: empty. */
  mcpServers: Readonly<Record<string, McpServerConfig>>;
  /** Optional process-local root for trusted Knowledge Space directories. */
  knowledge: KnowledgeConfig;
  /** Operator web search engines and chain; absent when not configured. */
  webSearch?: WebSearchConfig;
  /**
   * Operator-managed skill source directories (system-provided-skills D1):
   * ordered collection directories whose immediate child directories are skill
   * packages. Later sources override earlier sources by package name. These are
   * literal public filesystem paths — no interpolation is applied or allowed.
   */
  skills: SkillsConfig;
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
    timeoutSeconds: null,
  },
  http: {
    trustProxy: null,
  },
  db: {
    poolSize: 10,
  },
  tools: {
    allowed: [],
    permissions: {},
    permissionModes: ['default'],
    maxStepsPerRun: null,
    callTimeoutSeconds: 120,
    promptFiles: {},
    webAdapters: [],
  },
  mcpServers: {},
  knowledge: {},
  skills: { directories: [] },
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
