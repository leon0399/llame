import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { type Tool } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { createMcpBoundedFetch } from '../../mcp/mcp-bounded-fetch';
import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type RawResult,
} from './chain';
import { VENDOR_RESPONSE_MAX_BYTES, type VendorFetch } from './http';

export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const EXA_MCP_TOOL_NAME = 'web_search_exa';
const EXA_FREE_LIMIT_MARKER = "Exa's free MCP rate limit";
const McpCallResultSchema = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
});
const McpTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
const McpErrorSchema = z.object({ statusCode: z.number().optional() });

type HttpTransport = Parameters<typeof createMCPClient>[0]['transport'];
type ExaTool = Required<Pick<Tool<unknown, unknown>, 'execute'>>;
type ExaToolSet = Readonly<Record<string, ExaTool>>;
type McpCallResult = z.infer<typeof McpCallResultSchema>;
type ExaSession = { readonly client: MCPClient; readonly tool: ExaTool };

type SessionAccess = {
  readonly get: () => Promise<ExaSession>;
  readonly discard: (session: Promise<ExaSession>) => void;
};

function classifyError(
  error: unknown,
): 'auth' | 'rate_limited' | 'upstream_error' {
  const status = McpErrorSchema.safeParse(error).data?.statusCode;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

function textParts(value: McpCallResult): Array<string> {
  return value.content.flatMap((part): Array<string> => {
    const parsed = McpTextPartSchema.safeParse(part);
    return parsed.success ? [parsed.data.text] : [];
  });
}

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

async function waitForSession(
  session: Promise<ExaSession>,
  signal: AbortSignal,
): Promise<ExaSession> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Exa MCP session wait aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([session, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

function parseCallResult(value: McpCallResult): EngineOutcome | undefined {
  const parts = textParts(value);
  if (parts.length === 0) return undefined;
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
  return results.length === 0 ? undefined : { kind: 'results', results };
}

function toolFromSet(value: ExaToolSet): ExaTool {
  const tool = value[EXA_MCP_TOOL_NAME];
  if (tool === undefined) throw new EngineFailure('upstream_error');
  return tool;
}

function createTransportFetch(
  boundedFetch: VendorFetch,
  getUserAgent: () => string | undefined,
): VendorFetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const userAgent = getUserAgent();
    if (userAgent !== undefined) headers.set('User-Agent', userAgent);
    return boundedFetch(input, { ...init, headers });
  };
}

/** Bound on the shared handshake, independent of any caller's signal. */
const EXA_MCP_SESSION_TIMEOUT_MS = 60_000;

function createSessionAccess(transport: HttpTransport): SessionAccess {
  let session: Promise<ExaSession> | undefined;
  const get = (): Promise<ExaSession> => {
    if (session !== undefined) return session;
    const initialization = createMCPClient({ transport, maxRetries: 0 }).then(
      async (client) => {
        try {
          return { client, tool: toolFromSet(await client.tools()) };
        } catch (error: unknown) {
          void client.close().catch(() => undefined);
          throw error;
        }
      },
    );
    const current = waitForSession(
      initialization,
      AbortSignal.timeout(EXA_MCP_SESSION_TIMEOUT_MS),
    ).catch((error: unknown) => {
      if (session === current) session = undefined;
      void initialization
        .then(({ client }) => client.close())
        .catch(() => undefined);
      throw error;
    });
    session = current;
    return current;
  };
  const discard = (failedSession: Promise<ExaSession>): void => {
    if (session !== failedSession) return;
    session = undefined;
    void failedSession
      .then(({ client }) => client.close())
      .catch(() => undefined);
  };
  return { get, discard };
}

async function executeSearchTool(
  tool: ExaTool,
  request: EngineRequest,
): Promise<McpCallResult> {
  const value = await tool.execute(
    {
      query: request.query,
      numResults: request.limit,
      objective: request.query,
    },
    {
      toolCallId: EXA_MCP_TOOL_NAME,
      messages: [],
      abortSignal: request.signal,
    },
  );
  const parsed = McpCallResultSchema.safeParse(value);
  if (!parsed.success) throw new EngineFailure('upstream_error');
  return parsed.data;
}

/** Create an Exa hosted MCP adapter called internally by the web-search tool. */
export function createExaMcpEngine(
  config: { readonly key: string | undefined },
  deps: { readonly fetch: VendorFetch },
): Engine {
  let userAgent: string | undefined;
  const boundedFetch = createMcpBoundedFetch({
    fetch: deps.fetch,
    maxResponseBytes: VENDOR_RESPONSE_MAX_BYTES,
  });
  const transport: HttpTransport = {
    type: 'http',
    url: EXA_MCP_URL,
    redirect: 'error',
    fetch: createTransportFetch(boundedFetch, () => userAgent),
  };
  if (config.key !== undefined) transport.headers = { 'x-api-key': config.key };
  const { get, discard } = createSessionAccess(transport);
  return async (request) => {
    userAgent = request.userAgent;
    request.signal.throwIfAborted();
    const session = get();
    let result: McpCallResult;
    try {
      const { tool } = await waitForSession(session, request.signal);
      result = await executeSearchTool(tool, request);
    } catch (error: unknown) {
      request.signal.throwIfAborted();
      discard(session);
      throw new EngineFailure(classifyError(error));
    }
    const outcome = parseCallResult(result);
    if (outcome === undefined) {
      discard(session);
      throw new EngineFailure('upstream_error');
    }
    if (request.recency === undefined) return outcome;
    return { ...outcome, notes: ['recency not applied by exa-mcp'] };
  };
}
