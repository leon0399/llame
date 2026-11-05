import { z } from 'zod';
import { loadPackagedToolDescription } from '../../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from '../types';
import {
  WEB_SEARCH_FETCH_LIMIT_DEFAULT,
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/web-search-config';
import { createAggregateEngine } from './aggregate';
import {
  createEngine,
  executeSearchChain,
  type Engine,
  type EngineLookup,
  type EngineRequest,
} from './chain';
import { splitSiteFilters } from './query';
import { createResultRemoval } from './removal';
import { spillWebSearchResult } from './artifact';
import { ENGINE_LIMITS, TOOL_QUERY_MAX } from './limits';

export const webSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(TOOL_QUERY_MAX),
  objective: z.string().min(1).max(2000).optional(),
  /**
   * The engines to run for this call, in order, in place of the configured
   * chain. Ids are plain strings, so the schema stays static; the tool checks
   * them against the configured engines before any request. A length counts
   * code points, the unit the configuration's own bound uses, so every
   * configured id is selectable.
   */
  engines: z
    .array(
      z
        .string()
        .min(1)
        .refine((id) => Array.from(id).length <= 64, {
          message: 'An engine id is at most 64 characters.',
        }),
    )
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Engine ids must be unique.',
    })
    .optional(),
  recency: z.enum(['day', 'week', 'month', 'year']).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
export type WebSearchArguments = z.output<typeof webSearchInputSchema>;
export const WEB_SEARCH_NOT_CONFIGURED_MESSAGE =
  'Web search is not configured.';

const engineLookups = new WeakMap<WebSearchConfig, EngineLookup>();

function buildEngineLookup(config: WebSearchConfig): EngineLookup {
  const engines = new Map<string, Engine>();
  const entries = new Map(
    config.engines
      .filter(
        (
          entry,
        ): entry is Exclude<WebSearchEngineConfig, { type: 'aggregate' }> =>
          entry.type !== 'aggregate',
      )
      .map((entry) => [entry.id, entry]),
  );
  for (const engineConfig of config.engines) {
    if (engineConfig.type === 'aggregate') continue;
    engines.set(
      engineConfig.id,
      createEngine(engineConfig, { fetch: globalThis.fetch }),
    );
  }
  for (const engineConfig of config.engines) {
    if (engineConfig.type !== 'aggregate') continue;
    const children = engineConfig.engines.map((id) => {
      const childConfig = entries.get(id)!;
      return {
        id,
        timeoutSeconds: childConfig.timeoutSeconds,
        limits: ENGINE_LIMITS[childConfig.type],
        engine: engines.get(id)!,
      };
    });
    engines.set(engineConfig.id, createAggregateEngine(children));
  }
  return (id) => engines.get(id)!;
}

function engineLookupFor(config: WebSearchConfig): EngineLookup {
  const cached = engineLookups.get(config);
  if (cached !== undefined) return cached;
  const lookup = buildEngineLookup(config);
  engineLookups.set(config, lookup);
  return lookup;
}

/**
 * The tool error for a selected engine id the operator did not configure, or
 * `undefined` when every id is configured. A local decision before any engine
 * runs: the ids are the model's own text, and the configured ids carry no
 * credential, base URL, or folder id.
 */
function unknownEngineFailure(
  config: WebSearchConfig,
  engines: ReadonlyArray<string> | undefined,
): ToolResult | undefined {
  const unknown = engines?.find(
    (id) => !config.engines.some((entry) => entry.id === id),
  );
  if (unknown === undefined) return undefined;
  return {
    status: 'error',
    type: 'web_search_failed',
    message: `Unknown web search engine "${unknown}". Configured engines: ${config.engines
      .map((entry) => entry.id)
      .join(', ')}.`,
  };
}

/** The engine request one call sends, with the fetched size as its limit. */
function searchRequest(
  context: ToolContext,
  input: WebSearchArguments,
  fetchSize: number,
): EngineRequest {
  return {
    query: input.query,
    objective: input.objective,
    engines: input.engines,
    limit: fetchSize,
    signal: context.abortSignal ?? new AbortController().signal,
    recency: input.recency,
    userAgent: context.productUserAgent,
    chatId: context.chatId,
    removal: createResultRemoval(
      context,
      splitSiteFilters(input.query).exclude,
    ),
    modelClients: context.modelClients,
  };
}

export const webSearchTool: Tool<WebSearchArguments> = {
  id: 'web_search',
  description: loadPackagedToolDescription('web_search'),
  classification: 'read_only',
  spill: 'tool',
  inputSchema: webSearchInputSchema,
  async execute(
    context: ToolContext,
    input: WebSearchArguments,
  ): Promise<ToolResult> {
    const config = context.webSearch;
    if (config === undefined)
      return {
        status: 'error',
        type: 'web_search_failed',
        message: WEB_SEARCH_NOT_CONFIGURED_MESSAGE,
      };
    const unknownEngine = unknownEngineFailure(config, input.engines);
    if (unknownEngine !== undefined) return unknownEngine;
    // The engines fetch the operator's size, clamped by each vendor; `limit`
    // still bounds what the model reads inline (tool-result-artifacts D9).
    const fetchSize = Math.max(
      input.limit,
      config.fetchLimit ?? WEB_SEARCH_FETCH_LIMIT_DEFAULT,
    );
    const result = await executeSearchChain(
      config,
      searchRequest(context, input, fetchSize),
      engineLookupFor(config),
    );
    return 'status' in result
      ? result
      : spillWebSearchResult(context, result, {
          limit: input.limit,
          fetchSize,
          ...(input.objective !== undefined && { objective: input.objective }),
        });
  },
};
