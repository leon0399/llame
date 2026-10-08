import { z } from 'zod';
import { loadPackagedToolDescription } from '../../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from '../types';
import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/llame-config';
import { createAggregateEngine } from './aggregate';
import {
  createEngine,
  executeSearchChain,
  type Engine,
  type EngineLookup,
  type EngineRequest,
} from './chain';
import { normalizeOutput } from './output';

export const webSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(1000),
  recency: z.enum(['day', 'week', 'month', 'year']).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
export type WebSearchArguments = z.output<typeof webSearchInputSchema>;
export const WEB_SEARCH_NOT_CONFIGURED_MESSAGE =
  'Web search is not configured.';

type EngineLookupCache = {
  readonly modelClients: ToolContext['modelClients'];
  readonly lookup: EngineLookup;
};
const engineLookups = new WeakMap<WebSearchConfig, EngineLookupCache>();

function buildEngineLookup(
  config: WebSearchConfig,
  modelClients: ToolContext['modelClients'],
): EngineLookup {
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
      createEngine(engineConfig, {
        fetch: globalThis.fetch,
        modelClients,
      }),
    );
  }
  for (const engineConfig of config.engines) {
    if (engineConfig.type !== 'aggregate') continue;
    const children = engineConfig.engines.map((id) => {
      const childConfig = entries.get(id)!;
      return {
        id,
        timeoutSeconds: childConfig.timeoutSeconds,
        engine: engines.get(id)!,
      };
    });
    engines.set(engineConfig.id, createAggregateEngine(children));
  }
  return (id) => engines.get(id)!;
}

function engineLookupFor(
  config: WebSearchConfig,
  modelClients: ToolContext['modelClients'],
): EngineLookup {
  const cached = engineLookups.get(config);
  if (cached !== undefined && cached.modelClients === modelClients)
    return cached.lookup;
  const lookup = buildEngineLookup(config, modelClients);
  engineLookups.set(config, { modelClients, lookup });
  return lookup;
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
    const signal = context.abortSignal ?? new AbortController().signal;
    const request: EngineRequest = {
      query: input.query,
      limit: input.limit,
      signal,
      recency: input.recency,
      userAgent: context.productUserAgent,
      chatId: context.chatId,
    };
    const result = await executeSearchChain(
      config,
      request,
      engineLookupFor(config, context.modelClients),
    );
    return 'status' in result ? result : normalizeOutput(result, input.limit);
  },
};
