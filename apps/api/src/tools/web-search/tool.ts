import { z } from 'zod';
import { loadPackagedToolDescription } from '../../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from '../types';
import {
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
import { normalizeOutput } from './output';
import { splitSiteFilters } from './query';
import { createResultRemoval } from './removal';
import { ENGINE_LIMITS } from './limits';

export const webSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(1000),
  objective: z.string().min(1).max(2000).optional(),
  /**
   * The engines to run for this call, in order, in place of the configured
   * chain. Ids are plain strings, so the schema stays static; the tool checks
   * them against the configured engines before any request.
   */
  engines: z
    .array(z.string().min(1).max(64))
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

export const webSearchTool: Tool<WebSearchArguments> = {
  id: 'web_search',
  description: loadPackagedToolDescription('web_search'),
  classification: 'read_only',
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
    const signal = context.abortSignal ?? new AbortController().signal;
    const request: EngineRequest = {
      query: input.query,
      objective: input.objective,
      engines: input.engines,
      limit: input.limit,
      signal,
      recency: input.recency,
      userAgent: context.productUserAgent,
      chatId: context.chatId,
      removal: createResultRemoval(
        context,
        splitSiteFilters(input.query).exclude,
      ),
      modelClients: context.modelClients,
    };
    const result = await executeSearchChain(
      config,
      request,
      engineLookupFor(config),
    );
    return 'status' in result ? result : normalizeOutput(result, input.limit);
  },
};
