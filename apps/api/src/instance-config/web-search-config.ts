/** Operator `webSearch` configuration types (extend-web-search D7, D8). */

/** A Parallel search mode; `fast` is the default for agent calls. */
export type ParallelSearchMode = 'turbo' | 'fast' | 'basic' | 'advanced';

/** The Yandex search index a `yandex` engine queries. */
export type YandexSearchType = 'ru' | 'tr' | 'com' | 'kk' | 'be' | 'uz';

/** The still-uninterpolated `webSearch` engine entry once schema-validated. */
export type RawWebSearchEngineEntry =
  | {
      id: string;
      type: 'brave' | 'deepseek' | 'exa' | 'perplexity';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'parallel';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      /** Schema-validated literal; no interpolation applies. */
      mode?: ParallelSearchMode;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'parallel-mcp';
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      type: 'yandex';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      /** Schema-validated literal; no interpolation applies. */
      searchType: YandexSearchType;
      /** Schema-validated optional folder id; interpolation may resolve blank. */
      folderId?: string | null;
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
          type: 'brave' | 'deepseek' | 'exa' | 'perplexity';
          /** Interpolated vendor credential; never surfaced in output or errors. */
          key: string;
        }
      | {
          type: 'parallel';
          /** Interpolated vendor credential; never surfaced in output or errors. */
          key: string;
          /** The vendor search mode; `fast` unless the operator sets another. */
          mode: ParallelSearchMode;
        }
      | { type: 'parallel-mcp' }
      | {
          type: 'yandex';
          /** Interpolated vendor credential; never surfaced in output or errors. */
          key: string;
          /** The search index this engine queries. */
          searchType: YandexSearchType;
          /**
           * Interpolated folder id, absent when the service-account key implies
           * it; never surfaced in output or errors.
           */
          folderId: string | undefined;
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
      /**
       * Two or more distinct engine ids run concurrently and merged; a
       * `model-hosted` child also contributes its grounded answer.
       */
      engines: ReadonlyArray<string>;
    };

/** Resolved operator `webSearch` section: engines and the ordered chain of their ids. */
export type WebSearchConfig = {
  engines: ReadonlyArray<WebSearchEngineConfig>;
  chain: ReadonlyArray<string>;
};
