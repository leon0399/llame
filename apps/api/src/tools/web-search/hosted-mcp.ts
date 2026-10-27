import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { type Tool } from '@ai-sdk/provider-utils';
import { createMcpBoundedFetch } from '@workspace/mcp-workspace';
import { z } from 'zod';
import { EngineFailure } from './chain';
import { VENDOR_RESPONSE_MAX_BYTES, type VendorFetch } from './http';

/** Bound on the shared handshake, independent of any caller's signal. */
const HOSTED_MCP_SESSION_TIMEOUT_MS = 60_000;

/** The envelope every MCP tool call answers with. */
export const McpCallResultSchema = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
});
export type McpCallResult = z.infer<typeof McpCallResultSchema>;
const McpTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
const McpErrorSchema = z.object({ statusCode: z.number().optional() });

type HttpTransport = Parameters<typeof createMCPClient>[0]['transport'];
type HostedTool = Required<Pick<Tool<unknown, unknown>, 'execute'>>;
type HostedToolSet = Readonly<Record<string, HostedTool>>;
type HostedSession = { readonly client: MCPClient; readonly tool: HostedTool };
type SessionSlot = {
  readonly session: Promise<HostedSession>;
  /** Calls using this session now; a dropped slot closes its client at zero. */
  inFlight: number;
  dropped: boolean;
};

/** What one call carries besides the tool arguments. */
export type HostedCallContext = {
  readonly signal: AbortSignal;
  readonly userAgent: string | undefined;
};

/** One hosted MCP endpoint, called from llame code and never exposed to a model. */
export type HostedMcp<TArguments> = {
  /**
   * Call the tool once and interpret its envelope here, so a throw is this
   * call's failure. A failed call leaves the cache at once, and its client
   * closes only when the calls that still use it finish.
   */
  readonly call: <TResult>(
    args: TArguments,
    context: HostedCallContext,
    interpret: (result: McpCallResult) => TResult,
  ) => Promise<TResult>;
};

type HostedMcpOptions = {
  readonly url: string;
  /** The tool the endpoint must declare; its other tools stay unused. */
  readonly toolName: string;
  /** Extra handshake headers, such as a vendor credential. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch: VendorFetch;
};

/** The text parts of one result, in order. */
export function mcpTextParts(value: McpCallResult): Array<string> {
  return value.content.flatMap((part): Array<string> => {
    const parsed = McpTextPartSchema.safeParse(part);
    return parsed.success ? [parsed.data.text] : [];
  });
}

/** A transport status the MCP client attached to its error, as a class. */
function classifyError(
  error: unknown,
): 'auth' | 'rate_limited' | 'upstream_error' {
  const status = McpErrorSchema.safeParse(error).data?.statusCode;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

async function waitForSession(
  session: Promise<HostedSession>,
  signal: AbortSignal,
): Promise<HostedSession> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Hosted MCP session wait aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([session, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

function toolFromSet(value: HostedToolSet, toolName: string): HostedTool {
  const tool = value[toolName];
  if (tool === undefined) throw new EngineFailure('upstream_error');
  return tool;
}

function openSession(
  transport: HttpTransport,
  toolName: string,
): Promise<HostedSession> {
  return createMCPClient({ transport, maxRetries: 0 }).then(async (client) => {
    try {
      return { client, tool: toolFromSet(await client.tools(), toolName) };
    } catch (error: unknown) {
      void client.close().catch(() => undefined);
      throw error;
    }
  });
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

function createTransport(
  options: HostedMcpOptions,
  fetch: VendorFetch,
): HttpTransport {
  const transport: HttpTransport = {
    type: 'http',
    url: options.url,
    redirect: 'error',
    fetch,
  };
  if (options.headers !== undefined) transport.headers = options.headers;
  return transport;
}

type SessionCache = {
  readonly acquire: () => SessionSlot;
  readonly drop: (target: SessionSlot) => void;
  /** Close a dropped session once no call uses it any more. */
  readonly closeIfIdle: (target: SessionSlot) => void;
};

function closeSession(target: SessionSlot): void {
  void target.session
    .then(({ client }) => client.close())
    .catch(() => undefined);
}

function createSessionCache(
  transport: HttpTransport,
  toolName: string,
): SessionCache {
  let slot: SessionSlot | undefined;
  /** Forget a session for later calls; its client closes when it is idle. */
  const drop = (target: SessionSlot): void => {
    target.dropped = true;
    if (slot === target) slot = undefined;
  };
  const acquire = (): SessionSlot => {
    if (slot !== undefined) return slot;
    const initialization = openSession(transport, toolName);
    const session = waitForSession(
      initialization,
      AbortSignal.timeout(HOSTED_MCP_SESSION_TIMEOUT_MS),
    );
    const current: SessionSlot = { session, inFlight: 0, dropped: false };
    // A failed handshake does not stay cached, and a client that arrives after
    // the handshake gave up is closed instead of leaking.
    void session.catch(() => {
      if (slot === current) slot = undefined;
      void initialization
        .then(({ client }) => client.close())
        .catch(() => undefined);
    });
    slot = current;
    return current;
  };
  const closeIfIdle = (target: SessionSlot): void => {
    if (target.dropped && target.inFlight === 0) closeSession(target);
  };
  return { acquire, drop, closeIfIdle };
}

type CallDeps = {
  readonly cache: SessionCache;
  readonly toolName: string;
  readonly setUserAgent: (value: string | undefined) => void;
};

async function callHostedTool<TArguments, TResult>(
  deps: CallDeps,
  args: TArguments,
  context: HostedCallContext,
  interpret: (result: McpCallResult) => TResult,
): Promise<TResult> {
  const { signal } = context;
  signal.throwIfAborted();
  deps.setUserAgent(context.userAgent);
  const current = deps.cache.acquire();
  current.inFlight += 1;
  let toolError = false;
  try {
    const { tool } = await waitForSession(current.session, signal);
    const parsed = McpCallResultSchema.safeParse(
      await tool.execute(args, {
        toolCallId: deps.toolName,
        messages: [],
        abortSignal: signal,
      }),
    );
    if (!parsed.success) throw new EngineFailure('upstream_error');
    toolError = parsed.data.isError === true;
    return interpret(parsed.data);
  } catch (error: unknown) {
    // A caller's abort is not a vendor failure, and it keeps the session.
    if (signal.aborted) signal.throwIfAborted();
    // A tool-level error arrives as HTTP 200: the transport is healthy, so its
    // session stays for the next call. Any other failure poisons it.
    if (!toolError) deps.cache.drop(current);
    throw error instanceof EngineFailure
      ? error
      : new EngineFailure(classifyError(error));
  } finally {
    current.inFlight -= 1;
    deps.cache.closeIfIdle(current);
  }
}

/** Create one hosted MCP client whose handshake and tool lookup are shared. */
export function createHostedMcp<TArguments>(
  options: HostedMcpOptions,
): HostedMcp<TArguments> {
  const boundedFetch = createMcpBoundedFetch({
    fetch: options.fetch,
    maxResponseBytes: VENDOR_RESPONSE_MAX_BYTES,
  });
  // The callers' agents are identical per instance; the latest one wins any
  // request still in flight, as the single transport serves them all.
  let userAgent: string | undefined;
  const cache = createSessionCache(
    createTransport(
      options,
      createTransportFetch(boundedFetch, () => userAgent),
    ),
    options.toolName,
  );
  const deps: CallDeps = {
    cache,
    toolName: options.toolName,
    setUserAgent: (value) => {
      userAgent = value;
    },
  };
  return {
    call: (args, context, interpret) =>
      callHostedTool(deps, args, context, interpret),
  };
}
