import { z } from 'zod';
import { loadPackagedToolDescription } from '../../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from '../types';
import { type WebSearchConfig } from '../../instance-config/llame-config';
import {
  createEngine,
  executeSearchChain,
  type Engine,
  type EngineRequest,
} from './chain';
import { normalizeSearchOutput } from './output';

export const webSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(1000),
  recency: z.enum(['day', 'week', 'month', 'year']).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
export type WebSearchArguments = z.output<typeof webSearchInputSchema>;
export const WEB_SEARCH_NOT_CONFIGURED_MESSAGE =
  'Web search is not configured.';

function buildEngineLookup(
  config: WebSearchConfig,
): (id: string) => Engine | undefined {
  const engines = new Map<string, Engine>();
  for (const engineConfig of config.engines)
    engines.set(
      engineConfig.id,
      createEngine(engineConfig, { fetch: globalThis.fetch }),
    );
  return (id) => engines.get(id);
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
    const signals = [context.abortSignal, context.timeoutSignal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    const signal =
      signals.length === 0
        ? new AbortController().signal
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals);
    const request: EngineRequest = {
      query: input.query,
      limit: input.limit,
      signal,
      ...(input.recency !== undefined && { recency: input.recency }),
      ...(context.productUserAgent !== undefined && {
        userAgent: context.productUserAgent,
      }),
    };
    const result = await executeSearchChain(
      config,
      request,
      buildEngineLookup(config),
    );
    return 'status' in result
      ? result
      : normalizeSearchOutput(result, input.limit);
  },
};
