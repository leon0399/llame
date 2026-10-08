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
export const EXA_MCP_TOOL_NAME = 'web_search_exa';
const EXA_FREE_LIMIT_MARKER = "Exa's free MCP rate limit";
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;
const McpCallResultSchema = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
});
const McpTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
const McpErrorSchema = z.object({ statusCode: z.number().optional() });

type HttpTransport = {
  readonly type: 'http';
  readonly url: string;
  readonly redirect: 'error';
  readonly fetch: VendorFetch;
  headers?: Readonly<Record<string, string>>;
};
type ExaTool = Required<Pick<Tool<unknown, unknown>, 'execute'>>;
type ExaToolSet = Readonly<Record<string, ExaTool>>;
type McpCallResult = z.infer<typeof McpCallResultSchema>;
type TextPart = { readonly type: 'text'; readonly text: string };
type ParsedCall =
  | { readonly kind: 'outcome'; readonly outcome: EngineOutcome }
  | {
      readonly kind: 'failure';
      readonly failureClass: 'auth' | 'rate_limited' | 'upstream_error';
      readonly discard: boolean;
    };

type MutableRawResult = {
  title: string;
  url: string;
  snippet?: string;
  published?: string;
};

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The Exa MCP search was aborted.', 'AbortError');
}

function classifyError(
  error: Error,
): 'auth' | 'rate_limited' | 'upstream_error' {
  const status = McpErrorSchema.safeParse(error).data?.statusCode;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

function textParts(value: McpCallResult): Array<TextPart> {
  return value.content.flatMap((part): Array<TextPart> => {
    const parsed = McpTextPartSchema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
}

function parsePublished(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    !ISO_DATE.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    return undefined;
  return value;
}

function parseBlock(block: string): RawResult | undefined {
  let title = '';
  let url: string | undefined;
  let published: string | undefined;
  let collectingHighlights = false;
  const highlights: Array<string> = [];

  for (const line of block.split(/\r?\n/u)) {
    const field = line
      .trimStart()
      .match(/^(Title|URL|Published|Highlights):[ \t]*(.*)$/u);
    if (field === null) {
      if (collectingHighlights) highlights.push(line);
      continue;
    }
    const [, name, value] = field;
    collectingHighlights = name === 'Highlights';
    if (name === 'Title') title = value;
    else if (name === 'URL') url = value.trim();
    else if (name === 'Published') published = parsePublished(value.trim());
    else highlights.push(value);
  }

  if (url === undefined || url === '') return undefined;
  const snippet = highlights
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
  const result: MutableRawResult = { title, url };
  if (snippet !== '') result.snippet = snippet;
  if (published !== undefined) result.published = published;
  return result;
}

function parseCallResult(value: McpCallResult): ParsedCall {
  const parts = textParts(value);
  if (parts.length === 0)
    return { kind: 'failure', failureClass: 'upstream_error', discard: true };
  const text = parts.map(({ text: part }) => part).join('\n');
  if (value.isError === true) {
    if (/\((?:401|403)\)/u.test(text))
      return { kind: 'failure', failureClass: 'auth', discard: false };
    if (/\(429\)/u.test(text) || text.includes(EXA_FREE_LIMIT_MARKER))
      return { kind: 'failure', failureClass: 'rate_limited', discard: false };
    return { kind: 'failure', failureClass: 'upstream_error', discard: false };
  }
  if (text.trimStart().startsWith('No search results found'))
    return { kind: 'outcome', outcome: { kind: 'empty' } };
  const results = parts.flatMap(({ text: part }) =>
    part.split(/^---[ \t]*$/mu).flatMap((block) => {
      const result = parseBlock(block);
      return result === undefined ? [] : [result];
    }),
  );
  if (results.length === 0)
    return { kind: 'failure', failureClass: 'upstream_error', discard: true };
  return { kind: 'outcome', outcome: { kind: 'results', results } };
}

function toolFromSet(value: ExaToolSet): ExaTool {
  const tool = value[EXA_MCP_TOOL_NAME];
  if (tool === undefined)
    throw new Error('Exa MCP endpoint did not provide web_search_exa.');
  return tool;
}

class ExaMcpClientState {
  private clientPromise: Promise<MCPClient> | undefined;
  private toolPromise: Promise<ExaTool> | undefined;

  constructor(
    private readonly transport: HttpTransport,
    private readonly setUserAgent: (value: string | undefined) => void,
  ) {}

  setRequestUserAgent(value: string | undefined): void {
    this.setUserAgent(value);
  }

  async getTool(signal: AbortSignal): Promise<ExaTool> {
    const client = await this.getClient(signal);
    if (this.toolPromise === undefined) {
      this.toolPromise = client
        .tools()
        .then(toolFromSet)
        .catch((error: unknown) => {
          this.toolPromise = undefined;
          throw error;
        });
    }
    return this.toolPromise;
  }

  discard(): void {
    const previous = this.clientPromise;
    this.clientPromise = undefined;
    this.toolPromise = undefined;
    if (previous !== undefined)
      void previous.then((client) => client.close()).catch(() => undefined);
  }

  private getClient(signal: AbortSignal): Promise<MCPClient> {
    if (this.clientPromise !== undefined) return this.clientPromise;
    this.clientPromise = createMCPClient({
      transport: this.transport,
      maxRetries: 0,
      initializationOptions: { signal },
    }).catch((error: unknown) => {
      this.clientPromise = undefined;
      this.toolPromise = undefined;
      throw error;
    });
    return this.clientPromise;
  }
}

function createTransport(
  config: { readonly key: string | undefined },
  fetch: VendorFetch,
): HttpTransport {
  const transport: HttpTransport = {
    type: 'http',
    url: EXA_MCP_URL,
    redirect: 'error',
    fetch,
  };
  if (config.key !== undefined) transport.headers = { 'x-api-key': config.key };
  return transport;
}

function createClientState(
  config: { readonly key: string | undefined },
  deps: { readonly fetch: VendorFetch },
): ExaMcpClientState {
  let userAgent: string | undefined;
  const boundedFetch = createMcpBoundedFetch({
    fetch: deps.fetch,
    maxResponseBytes: VENDOR_RESPONSE_MAX_BYTES,
  });
  const transportFetch: VendorFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (userAgent !== undefined) headers.set('User-Agent', userAgent);
    return boundedFetch(input, { ...init, headers });
  };
  return new ExaMcpClientState(
    createTransport(config, transportFetch),
    (value) => {
      userAgent = value;
    },
  );
}

async function executeSearchTool(
  tool: ExaTool,
  request: EngineRequest,
): Promise<McpCallResult> {
  throwIfAborted(request.signal);
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
  throwIfAborted(request.signal);
  const parsed = McpCallResultSchema.safeParse(value);
  if (!parsed.success) throw new EngineFailure('upstream_error');
  return parsed.data;
}

/** Create an Exa hosted MCP adapter called internally by the web-search tool. */
export function createExaMcpEngine(
  config: { readonly key: string | undefined },
  deps: { readonly fetch: VendorFetch },
): Engine {
  const state = createClientState(config, deps);
  return async (request) => {
    state.setRequestUserAgent(request.userAgent);
    throwIfAborted(request.signal);
    let result: McpCallResult;
    try {
      const tool = await state.getTool(request.signal);
      result = await executeSearchTool(tool, request);
    } catch (error) {
      if (request.signal.aborted) throwIfAborted(request.signal);
      state.discard();
      const safeError =
        error instanceof Error ? error : new Error('MCP request failed.');
      throw new EngineFailure(classifyError(safeError));
    }

    const parsed = parseCallResult(result);
    if (parsed.kind === 'failure') {
      if (parsed.discard) state.discard();
      throw new EngineFailure(parsed.failureClass);
    }
    if (request.recency === undefined) return parsed.outcome;
    return { ...parsed.outcome, notes: ['recency not applied by exa-mcp'] };
  };
}
