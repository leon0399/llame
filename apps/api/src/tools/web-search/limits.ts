import { type WebSearchEngineConfig } from '../../instance-config/web-search-config';

type EngineType = WebSearchEngineConfig['type'];

/** An engine type whose vendor takes a result count. */
type CountEngineType =
  | 'brave'
  | 'deepseek'
  | 'exa'
  | 'parallel'
  | 'perplexity'
  | 'yandex';

/** What one engine type accepts from the model's `query` and `limit`. */
export type EngineLimits = {
  /** Absent when the vendor accepts every query the tool's own bound allows. */
  readonly query?: { readonly codePoints: number; readonly words?: number };
  /**
   * The vendor's maximum result count; absent when the vendor caps nothing. An
   * engine whose API takes no count parameter cuts to `limit` instead.
   */
  readonly results?: number;
};

/**
 * The vendor bounds of each engine type, from its API reference. The tool's
 * `query` bound is 1,000 units, so only a shorter vendor bound appears here. An
 * `aggregate` has no limit of its own and checks each child instead.
 */
export const ENGINE_LIMITS = {
  brave: { query: { codePoints: 600, words: 75 }, results: 20 },
  deepseek: { query: { codePoints: 128 }, results: 50 },
  exa: { results: 100 },
  'exa-mcp': {},
  parallel: { query: { codePoints: 200 }, results: 20 },
  'parallel-mcp': { query: { codePoints: 200 } },
  perplexity: { results: 20 },
  searxng: {},
  duckduckgo: {},
  'model-hosted': {},
  yandex: { query: { codePoints: 400, words: 40 }, results: 100 },
  aggregate: {},
} as const satisfies Readonly<Record<EngineType, EngineLimits>>;

/**
 * Whether a query fits an engine's limit before it sends any request. Lengths
 * are code points, so a surrogate pair counts once; a word is a run of
 * non-space characters.
 */
export function acceptsQuery(limits: EngineLimits, query: string): boolean {
  const limit = limits.query;
  if (limit === undefined) return true;
  if (Array.from(query).length > limit.codePoints) return false;
  return (
    limit.words === undefined ||
    (query.match(/\S+/gu)?.length ?? 0) <= limit.words
  );
}

/** The count to request: the call's `limit`, clamped to a vendor maximum. */
export function vendorCount(type: CountEngineType, limit: number): number {
  return Math.min(limit, ENGINE_LIMITS[type].results);
}
