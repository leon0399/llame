import { EngineFailure, canonicalizeResults, type Engine } from './chain';
import { type VendorFetch } from './http';
import { createHostedMcp, type McpCallResult } from './hosted-mcp';
import {
  ParallelPayloadSchema,
  mapParallelResults,
  type ParallelPayload,
} from './parallel';

export const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';
const PARALLEL_MCP_TOOL_NAME = 'web_search';
const RECENCY_NOTE = 'recency not applied by parallel-mcp';

type ParallelToolArguments = {
  readonly objective: string;
  readonly search_queries: ReadonlyArray<string>;
  readonly session_id: string;
};

/**
 * The search payload of a tool result. The hosted tool answers with
 * `structuredContent`; a tool error shares that envelope and is dropped with
 * its vendor text.
 */
function payloadOf(value: McpCallResult): ParallelPayload {
  if (value.isError === true) throw new EngineFailure('upstream_error');
  const parsed = ParallelPayloadSchema.safeParse(value.structuredContent);
  if (!parsed.success) throw new EngineFailure('upstream_error');
  return parsed.data;
}

/** Create a keyless hosted Parallel MCP adapter for the web-search tool. */
export function createParallelMcpEngine(deps: {
  readonly fetch: VendorFetch;
}): Engine {
  const mcp = createHostedMcp<ParallelToolArguments>({
    url: PARALLEL_MCP_URL,
    toolName: PARALLEL_MCP_TOOL_NAME,
    fetch: deps.fetch,
  });
  return async (request) => {
    const extra =
      request.recency === undefined ? {} : { notes: [RECENCY_NOTE] };
    const payload = await mcp.call(
      {
        objective: request.objective ?? request.query,
        search_queries: [request.query],
        session_id: request.chatId,
      },
      { signal: request.signal, userAgent: request.userAgent },
      payloadOf,
    );
    // The hosted tool takes no result count, so the cut comes after URLs that
    // fail validation are gone.
    const results = canonicalizeResults(mapParallelResults(payload)).slice(
      0,
      request.limit,
    );
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
