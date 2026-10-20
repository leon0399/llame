import {
  createMcpBoundedFetch,
  type McpFetch,
  type McpFetchRequestContext,
} from './mcp-bounded-fetch';

/**
 * A server presenting a session id other than the one this connection already
 * learned has replaced its session underneath the connection: the old session
 * is gone, so the caller must fail the operation rather than keep talking to a
 * session the server no longer honours.
 */
export class McpSessionChangedError extends Error {
  constructor() {
    super('The MCP server changed its active session id.');
    this.name = 'McpSessionChangedError';
  }
}

export type McpGuardedFetchInput = Readonly<{
  readonly fetch: McpFetch;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes: number;
  readonly onBytes?: (count: number, request: McpFetchRequestContext) => void;
  /** Called once, with the first session id the server presents. */
  readonly onSessionId?: (sessionId: string) => void;
}>;

/**
 * The HTTP safeguards both sides of the relay apply to a Workspace MCP server:
 * every response body is bounded before it is parsed, a redirect is refused
 * outright, and the server's session id is tracked — the first one learned is
 * reported to the caller as a protected value, and any later change is an
 * error.
 *
 * The session id matters for redaction rather than for the protocol: a server
 * that issues one expects it on every later request, so it travels in traffic
 * a tool result can echo, and it must be redacted like a configured secret.
 * The Machine daemon reports it to the hub over `mcp.protected`; the hub keeps
 * it in its own protected-value set.
 */
export function createMcpGuardedFetch(input: McpGuardedFetchInput): McpFetch {
  const boundedFetch = createMcpBoundedFetch({
    fetch: input.fetch,
    maxResponseBytes: input.maxResponseBytes,
    ...(input.maxRequestBytes !== undefined && {
      maxRequestBytes: input.maxRequestBytes,
    }),
    ...(input.onBytes !== undefined && { onBytes: input.onBytes }),
  });
  let sessionId: string | undefined;

  return async (request, init) => {
    const response = await boundedFetch(request, init);
    const observed = response.headers.get('mcp-session-id');
    if (observed === null || observed.length === 0) return response;
    if (sessionId === undefined) {
      sessionId = observed;
      input.onSessionId?.(observed);
      return response;
    }
    if (sessionId === observed) return response;
    await response.body?.cancel().catch(() => undefined);
    throw new McpSessionChangedError();
  };
}
