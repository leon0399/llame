/** Operator `webSearch` configuration types (extend-web-search D7, D8). */

import type {
  RawToolRerankConfig,
  ToolRerankConfig,
} from './tool-rerank-config';

/** A Parallel search mode; `fast` is the default for agent calls. */
export type ParallelSearchMode = 'turbo' | 'fast' | 'basic' | 'advanced';

/** The Yandex search index a `yandex` engine queries. */
export type YandexSearchType = 'ru' | 'tr' | 'com' | 'kk' | 'be' | 'uz';

/**
 * The still-uninterpolated `webSearch` engine entry once schema-validated.
 * Every entry, an `aggregate` included, can carry a literal `description` of 1
 * to 200 characters on one line, which never interpolates.
 */
export type RawWebSearchEngineEntry =
  | {
      id: string;
      description?: string;
      type: 'brave' | 'deepseek' | 'exa' | 'perplexity';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'parallel';
      /** Schema-required credential; interpolation may still resolve blank. */
      key: string | null;
      /** Schema-validated literal; no interpolation applies. */
      mode?: ParallelSearchMode;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'parallel-mcp';
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
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
      description?: string;
      type: 'searxng';
      /** Required operator-controlled SearXNG base URL before interpolation. */
      baseUrl: string;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'exa-mcp';
      /** Optional Exa credential; interpolation may still resolve blank. */
      key?: string | null;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'duckduckgo';
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'model-hosted';
      /** A `models[].id`, resolved against the model catalog at startup. */
      model: string;
      timeoutSeconds?: unknown;
    }
  | {
      id: string;
      description?: string;
      type: 'aggregate';
      engines: Array<string>;
    };

/** The default `webSearch.fetchLimit`, before each vendor's own maximum. */
export const WEB_SEARCH_FETCH_LIMIT_DEFAULT = 20;
/** The still-uninterpolated operator `webSearch` section. */
export type RawWebSearchConfig = {
  engines: Array<RawWebSearchEngineEntry>;
  chain: Array<string>;
  /** Schema-validated integer of 1 to 100; no interpolation applies. */
  fetchLimit?: number;
  /** The tool's own rerank block; absent means no decision call. */
  rerank?: RawToolRerankConfig;
};

export type WebSearchEngineConfig =
  | ({
      id: string;
      /**
       * Operator-authored model-facing text the engine catalog shows, absent
       * when the operator sets none.
       */
      description?: string;
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
      description?: string;
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
  /**
   * How many results each call asks its engines for before a vendor maximum
   * clamps it (tool-result-artifacts D9). The loader always resolves it; a
   * directly built config may omit it and takes the built-in default.
   */
  fetchLimit?: number;
  /**
   * Opt-in ranking of this call's results by a catalogue decision model. The
   * tool reads its own setting here; an absent block means it never asks the
   * lane.
   */
  rerank?: ToolRerankConfig;
};
