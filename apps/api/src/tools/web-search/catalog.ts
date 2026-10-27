import { sanitizeAuthoredText } from '../../instance-config/authored-text';
import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/web-search-config';
import { ORI_QUESTION_MAX_CODE_POINTS } from './deepseek';
import { ENGINE_LIMITS, TOOL_QUERY_MAX, type EngineLimits } from './limits';
import {
  type PromptWebSearchEngineItem,
  type PromptWebSearchInput,
} from '../../instance-config/prompt-loader';

type EngineType = WebSearchEngineConfig['type'];
/** The per-type vendor bounds, typed so a child of any type is read the same way. */
const LIMITS: Readonly<Record<EngineType, EngineLimits>> = ENGINE_LIMITS;
/** The configured engines by id, so one catalog build looks each child up once. */
type EngineIndex = ReadonlyMap<string, WebSearchEngineConfig>;

/** How one engine type uses the call's `recency`. */
const RECENCY_USE: Record<EngineType, string> = {
  brave: 'recency applied as a freshness filter',
  deepseek:
    'recency applied by adding a date filter to the query, dropped with a note when the query is near its limit',
  exa: 'recency applied as a start date',
  'exa-mcp': 'recency ignored with a note',
  parallel: 'recency applied as a start date',
  'parallel-mcp': 'recency ignored with a note',
  perplexity: 'recency applied as a date filter',
  searxng: 'recency applied, with a week sent as a month',
  duckduckgo: 'recency applied as a date filter',
  'model-hosted': 'recency stated in the hosted request',
  yandex:
    'recency mapped, with a week sent as two weeks and a year not applied',
  aggregate: 'recency passed to each child',
};

/** How one engine type uses the call's `objective`; absent when it ignores it. */
const OBJECTIVE_USE: Partial<Record<EngineType, string>> = {
  exa: 'objective used for ranking',
  'exa-mcp': 'objective used for ranking',
  parallel: 'objective used for ranking',
  'parallel-mcp': 'objective used for ranking',
  deepseek: `objective used for ranking, first ${ORI_QUESTION_MAX_CODE_POINTS} characters`,
  'model-hosted': 'objective stated in the hosted request as a goal',
};

/** The code-point and word bounds one query must fit; either can be absent. */
type QueryBound = { readonly codePoints?: number; readonly words?: number };

/**
 * Neutralize operator text that sits inside the catalog's own `<engines>`
 * block. The shared sanitizer keeps a value from closing a tag it did not open
 * and from emitting a reserved name. `engines` stays out of the shared reserved
 * set because reserving it globally would strip the tag from every operator
 * prompt, so a value that spells a tag-shaped `engines` token — a balanced
 * forged block, or an unmatched opener the block's own closer would end — is
 * neutralized here, with the `<` escaped so the text stays readable.
 */
function catalogValue(value: string): string {
  return sanitizeAuthoredText(value).replaceAll(
    /<(\s*\/?\s*engines)(?=[\s/>]|$)/giu,
    '&lt;$1',
  );
}

/** A query bound as prose; an unbounded engine states the tool's own bound. */
function boundText(bound: QueryBound): string {
  const parts: Array<string> = [];
  if (bound.codePoints !== undefined)
    parts.push(`${bound.codePoints} characters`);
  if (bound.words !== undefined) parts.push(`${bound.words} words`);
  return parts.length === 0
    ? `${TOOL_QUERY_MAX} characters`
    : parts.join(' and ');
}

/**
 * Where an id runs in a default call: its own chain position, or the chain
 * aggregate that already reaches it as a child, so a model does not read a
 * covered engine as an uncovered one.
 */
function chainPosition(
  config: WebSearchConfig,
  byId: EngineIndex,
  id: string,
): string {
  const index = config.chain.indexOf(id);
  if (index !== -1) return `position ${index + 1} in the default chain`;
  const parent = config.chain.find((candidate) => {
    const engine = byId.get(candidate)!;
    return engine.type === 'aggregate' && engine.engines.includes(id);
  });
  return parent === undefined
    ? 'not in the default chain'
    : `runs in the default chain through ${parent}`;
}

/**
 * An aggregate has no limit of its own: the smallest child code-point and word
 * bounds are the lengths below which no child is skipped, because a child is
 * skipped for either bound.
 */
function aggregateQueryLimit(
  byId: EngineIndex,
  children: ReadonlyArray<string>,
): string {
  const bounds = children.flatMap((id) => {
    const query = LIMITS[byId.get(id)!.type].query;
    return query === undefined ? [] : [query];
  });
  const codePoints = bounds.map((bound) => bound.codePoints);
  const words = bounds.flatMap((bound) =>
    bound.words === undefined ? [] : [bound.words],
  );
  const bound: QueryBound = {
    ...(codePoints.length > 0 && { codePoints: Math.min(...codePoints) }),
    ...(words.length > 0 && { words: Math.min(...words) }),
  };
  return `${boundText(bound)}, under which no child is skipped`;
}

/** What one engine returns: results, a cited answer, or results and answers. */
function engineKind(
  byId: EngineIndex,
  engine: WebSearchEngineConfig,
): PromptWebSearchEngineItem['kind'] {
  if (engine.type === 'model-hosted') return 'answer';
  if (
    engine.type === 'aggregate' &&
    engine.engines.some((id) => byId.get(id)!.type === 'model-hosted')
  )
    return 'results with answers';
  return 'results';
}

/** How one engine uses the call's `objective`; absent when it ignores it. */
function objectiveUse(
  byId: EngineIndex,
  engine: WebSearchEngineConfig,
): string | undefined {
  if (engine.type !== 'aggregate') {
    return OBJECTIVE_USE[engine.type];
  }
  const childUsesOne = engine.engines.some(
    (id) => OBJECTIVE_USE[byId.get(id)!.type] !== undefined,
  );
  return childUsesOne
    ? 'objective passed to each child that accepts one'
    : undefined;
}

/** One engine's fact phrases, for a template to lay out and frame. */
function engineItem(
  config: WebSearchConfig,
  byId: EngineIndex,
  engine: WebSearchEngineConfig,
): PromptWebSearchEngineItem {
  const objective = objectiveUse(byId, engine);
  return {
    id: catalogValue(engine.id),
    type: engine.type,
    kind: engineKind(byId, engine),
    position: catalogValue(chainPosition(config, byId, engine.id)),
    recency: catalogValue(RECENCY_USE[engine.type]),
    queryLimit: catalogValue(
      engine.type === 'aggregate'
        ? aggregateQueryLimit(byId, engine.engines)
        : boundText(LIMITS[engine.type].query ?? {}),
    ),
    ...(objective !== undefined && { objective: catalogValue(objective) }),
    ...(engine.description !== undefined && {
      // The period ends the template's entry line, so the operator's own is
      // dropped BEFORE neutralization: stripping it afterwards would leave an
      // unterminated `<engines` that the end-of-value guard had escaped.
      description: catalogValue(engine.description.replace(/\.$/u, '')),
    }),
  };
}

/**
 * The `webSearch.engines` template collection (extend-web-search D5, revised
 * 2026-10-27): one item per configured engine, in configuration order, holding
 * only the fact phrases a template lays out. Every value is tag-neutralized,
 * the catalog's own `engines` tag included, and no key, base URL, folder id, or
 * model id ever becomes a field. The result is a function of the resolved
 * configuration alone, so a worker builds it once and the provider prompt cache
 * changes only when the operator edits engines.
 */
export function webSearchEngineItems(
  config: WebSearchConfig | undefined,
): PromptWebSearchInput | undefined {
  if (config === undefined) return undefined;
  const byId: EngineIndex = new Map(
    config.engines.map((engine) => [engine.id, engine]),
  );
  return {
    engines: config.engines.map((engine) => engineItem(config, byId, engine)),
  };
}
