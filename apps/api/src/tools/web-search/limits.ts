import { type WebSearchEngineConfig } from '../../instance-config/llame-config';

type EngineType = WebSearchEngineConfig['type'];

/** A vendor query limit, in code points and, where the vendor has one, words. */
type QueryLimit = {
  readonly codePoints: number;
  readonly words?: number;
};

/** What one engine type accepts from the model's `query` and `limit`. */
export type EngineLimits = {
  /** Absent when the vendor accepts every query the tool's own bound allows. */
  readonly query?: QueryLimit;
  /** The vendor's maximum result count; absent when its API takes no count. */
  readonly results?: number;
};

/**
 * The vendor bounds of each engine type, from its API reference. The tool's
 * `query` bound is 1,000 units, so only a shorter vendor bound appears here. An
 * `aggregate` has no limit of its own and checks each child instead.
 */
export const ENGINE_LIMITS = {
  brave: { query: { codePoints: 600, words: 75 }, results: 20 },
  exa: { results: 100 },
  'exa-mcp': {},
  perplexity: { results: 20 },
  searxng: {},
  duckduckgo: {},
  'model-hosted': {},
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
  if ((query.match(/[\s\S]/gu)?.length ?? 0) > limit.codePoints) return false;
  return (
    limit.words === undefined ||
    (query.match(/\S+/gu)?.length ?? 0) <= limit.words
  );
}
