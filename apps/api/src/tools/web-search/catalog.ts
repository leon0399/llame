import { sanitizeAuthoredText } from '../../instance-config/authored-text';
import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/web-search-config';
import { ENGINE_LIMITS, type EngineLimits } from './limits';

type EngineType = WebSearchEngineConfig['type'];
/** The per-type vendor bounds, typed so a child of any type is read the same way. */
const LIMITS: Readonly<Record<EngineType, EngineLimits>> = ENGINE_LIMITS;
/** The configured engines by id, so one catalog build looks each child up once. */
type EngineIndex = ReadonlyMap<string, WebSearchEngineConfig>;

/** How one engine type uses the call's `recency`. */
const RECENCY_USE: Record<EngineType, string> = {
  brave: 'recency applied as a freshness filter',
  deepseek:
    'recency appended to the query as an `after:` date, omitted when the query is too long',
  exa: 'recency applied as a start date',
  'exa-mcp': 'recency ignored with a note',
  parallel: 'recency applied as `after_date`',
  'parallel-mcp': 'recency ignored with a note',
  perplexity: 'recency applied as a recency filter',
  searxng: 'recency applied, with a week sent as a month',
  duckduckgo: 'recency applied as a date filter',
  'model-hosted': 'recency asked for in the hosted prompt',
  yandex:
    'recency mapped, with a week sent as two weeks and a year not applied',
  aggregate: 'recency passed to each child',
};

/** How one engine type uses the call's `objective`; absent when it ignores it. */
const OBJECTIVE_USE: Partial<Record<EngineType, string>> = {
  exa: 'objective sent as `objective`, the query when absent',
  'exa-mcp': 'objective sent as `objective`, the query when absent',
  parallel: 'objective sent as `objective`',
  'parallel-mcp': 'objective sent as `objective`, the query when absent',
  deepseek: 'objective sent as `ori_question`, cut to 128 characters',
  'model-hosted': 'objective sent as a `Goal:` line',
};

/** The chain position of an id, as an entry states it. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

/** The tool's own `query` bound, for an engine that adds nothing on top. */
const TOOL_QUERY_LIMIT = 1000;

function chainPosition(config: WebSearchConfig, id: string): string {
  const index = config.chain.indexOf(id);
  if (index === -1) return 'not in the default chain';
  const ordinal = ORDINALS[index];
  return ordinal === undefined
    ? `at position ${index + 1} in the default chain`
    : `${ordinal} in the default chain`;
}

/** The longest query an engine sends, as a code-point and word bound. */
function queryLimit(limits: EngineLimits): string {
  const query = limits.query;
  if (query === undefined) return `query limit ${TOOL_QUERY_LIMIT} characters`;
  return query.words === undefined
    ? `query limit ${query.codePoints} characters`
    : `query limit ${query.codePoints} characters and ${query.words} words`;
}

/**
 * An aggregate has no limit of its own: the smallest child limit is the length
 * below which no child is skipped.
 */
function aggregateQueryLimit(
  byId: EngineIndex,
  children: ReadonlyArray<string>,
): string {
  const codePoints = children.flatMap((id) => {
    const child = byId.get(id);
    const query = child === undefined ? undefined : LIMITS[child.type].query;
    return query === undefined ? [] : [query.codePoints];
  });
  return codePoints.length === 0
    ? `query limit ${TOOL_QUERY_LIMIT} characters`
    : `query limit ${Math.min(...codePoints)} characters, under which no child is skipped`;
}

/** One catalog line: the facts a model needs to choose and bound the engine. */
function engineEntry(
  config: WebSearchConfig,
  byId: EngineIndex,
  engine: WebSearchEngineConfig,
): string {
  let kind = 'results';
  if (engine.type === 'model-hosted') kind = 'answer';
  else if (
    engine.type === 'aggregate' &&
    engine.engines.some((id) => byId.get(id)?.type === 'model-hosted')
  )
    kind = 'results with answers';

  let objective: string | undefined;
  if (engine.type !== 'aggregate') objective = OBJECTIVE_USE[engine.type];
  else if (
    engine.engines.some((id) => {
      const child = byId.get(id);
      return child !== undefined && OBJECTIVE_USE[child.type] !== undefined;
    })
  )
    objective = 'objective passed to each child that accepts one';

  const facts = [
    engine.type,
    kind,
    chainPosition(config, engine.id),
    RECENCY_USE[engine.type],
    engine.type === 'aggregate'
      ? aggregateQueryLimit(byId, engine.engines)
      : queryLimit(LIMITS[engine.type]),
  ];
  if (objective !== undefined) facts.push(objective);
  if (engine.description !== undefined)
    facts.push(`description ${sanitizeAuthoredText(engine.description)}`);
  return `- ${sanitizeAuthoredText(engine.id)} [${engine.type}]: ${facts.join('; ')}.`;
}

/**
 * The generated engine catalog that follows the rendered `web_search`
 * description (design D5): one line per configured engine, in configuration
 * order, with no key, base URL, folder id, or model id. The text is a function
 * of the resolved configuration alone, so a worker builds it once and the
 * provider prompt cache changes only when the operator edits engines.
 */
export function renderEngineCatalog(
  config: WebSearchConfig | undefined,
): string | undefined {
  if (config === undefined || config.engines.length === 0) return undefined;
  const byId: EngineIndex = new Map(
    config.engines.map((engine) => [engine.id, engine]),
  );
  return [
    '<engines>',
    'Configured web search engines. `engines` runs only the ids it lists, in their order.',
    ...config.engines.map((engine) => engineEntry(config, byId, engine)),
    '</engines>',
  ].join('\n');
}
