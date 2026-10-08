import { z } from 'zod';
import { loadPackagedToolDescription } from '../../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from '../types';
import { type WebSearchConfig } from '../../instance-config/llame-config';
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

const engineLookups = new WeakMap<WebSearchConfig, EngineLookup>();

function buildEngineLookup(config: WebSearchConfig): EngineLookup {
  const engines = new Map<string, Engine>();
  for (const engineConfig of config.engines)
    engines.set(
      engineConfig.id,
      createEngine(engineConfig, { fetch: globalThis.fetch }),
    );
  return (id) => engines.get(id)!;
}

function engineLookupFor(config: WebSearchConfig): EngineLookup {
  let lookup = engineLookups.get(config);
  if (lookup === undefined) {
    lookup = buildEngineLookup(config);
    engineLookups.set(config, lookup);
  }
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
    };
    const result = await executeSearchChain(
      config,
      request,
      engineLookupFor(config),
    );
    return 'status' in result ? result : normalizeOutput(result, input.limit);
  },
};
