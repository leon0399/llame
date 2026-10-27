import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type RawResult,
} from './chain';
import { type VendorFetch } from './http';
import {
  createHostedMcp,
  mcpTextParts,
  type McpCallResult,
} from './hosted-mcp';

export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const EXA_MCP_TOOL_NAME = 'web_search_exa';
const EXA_FREE_LIMIT_MARKER = "Exa's free MCP rate limit";

type ExaToolArguments = {
  readonly query: string;
  readonly numResults: number;
  readonly objective: string;
};
function parseBlock(block: string): RawResult | undefined {
  let title = '';
  let url: string | undefined;
  let published: string | undefined;
  let collecting: 'highlights' | 'text' | undefined;
  const highlights: Array<string> = [];
  const text: Array<string> = [];
  const snippets = { highlights, text };

  for (const line of block.split(/\r?\n/u)) {
    if (collecting !== undefined) {
      snippets[collecting].push(line);
      continue;
    }
    const field = line
      .trimStart()
      .match(/^(Title|URL|Published|Highlights|Text):[ \t]*(.*)$/u);
    if (field === null) continue;
    const [, name, value] = field;
    if (name === 'Title') title = value;
    else if (name === 'URL') url = value.trim();
    else if (name === 'Published') published = value.trim();
    else {
      collecting = name === 'Highlights' ? 'highlights' : 'text';
      snippets[collecting].push(value);
    }
  }

  if (url === undefined || url === '') return undefined;
  const snippet = (
    snippets.highlights.length > 0 ? snippets.highlights : snippets.text
  )
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  return {
    title,
    url,
    ...(snippet !== '' && { snippet }),
    ...(published !== undefined && { published }),
  };
}

function parseCallResult(value: McpCallResult): EngineOutcome {
  const parts = mcpTextParts(value);
  if (parts.length === 0) throw new EngineFailure('upstream_error');
  const text = parts.join('\n');
  if (value.isError === true) {
    if (/\((?:401|403)\)/u.test(text)) throw new EngineFailure('auth');
    if (/\(429\)/u.test(text) || text.includes(EXA_FREE_LIMIT_MARKER))
      throw new EngineFailure('rate_limited');
    throw new EngineFailure('upstream_error');
  }
  if (text.trimStart().startsWith('No search results found'))
    return { kind: 'empty' };
  const results = parts.flatMap((part) =>
    part.split(/^---[ \t]*$/mu).flatMap((block) => {
      const result = parseBlock(block);
      return result === undefined ? [] : [result];
    }),
  );
  if (results.length === 0) throw new EngineFailure('upstream_error');
  return { kind: 'results', results };
}

/** Create an Exa hosted MCP adapter called internally by the web-search tool. */
export function createExaMcpEngine(
  config: { readonly key: string | undefined },
  deps: { readonly fetch: VendorFetch },
): Engine {
  const mcp = createHostedMcp<ExaToolArguments>({
    url: EXA_MCP_URL,
    toolName: EXA_MCP_TOOL_NAME,
    ...(config.key !== undefined && { headers: { 'x-api-key': config.key } }),
    fetch: deps.fetch,
  });
  return async (request) => {
    const outcome = await mcp.call(
      {
        query: request.query,
        numResults: request.limit,
        objective: request.objective ?? request.query,
      },
      { signal: request.signal, userAgent: request.userAgent },
      parseCallResult,
    );
    if (request.recency === undefined) return outcome;
    return { ...outcome, notes: ['recency not applied by exa-mcp'] };
  };
}
