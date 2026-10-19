/**
 * `McpServerClient.connectTransport` — the client llame builds for a Workspace
 * server of a Machine (remote-machines design D6). The transport here is an
 * in-memory `@ai-sdk/mcp` transport the test answers, which is the only seam
 * the Machine channel has: the hub owns the relayed transport and nothing else.
 */
import {
  validateJSONRPCMessage,
  type JSONRPCMessage,
  type MCPTransport,
  type MCPTransportSendOptions,
} from '@ai-sdk/mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROTECTED_VALUE_REDACTION_MARKER,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  McpProtocolUnsupportedError,
  McpServerClient,
  MCP_SERVER_CLIENT_PROTOCOL_VERSIONS,
  type McpCallOutcome,
  type McpDiscoveryResult,
} from './mcp-server-client';

/** The client's own fixed discovery deadline (`DISCOVERY_DEADLINE_MS`). */
const DISCOVERY_DEADLINE_MS = 30_000;

type SentMessage = Readonly<{
  message: JSONRPCMessage;
  options: MCPTransportSendOptions | undefined;
}>;

type FakeTransport = MCPTransport & {
  /** Every message the client sent, in order, with its request options. */
  readonly sent: ReadonlyArray<SentMessage>;
  readonly calls: { start: number; close: number };
  /** Answers the newest request of `method`; fails when none was sent. */
  answer(method: string, result: UnknownRecord): void;
  /** Rejects the newest request of `method`, as a closed channel does. */
  fail(method: string, error: Error): void;
};

type FakeTransportOptions = Readonly<{
  /** Returns the error `send` rejects with, or undefined to accept the message. */
  onSend?: (message: JSONRPCMessage) => Error | undefined;
}>;

/**
 * An in-memory MCP transport: it records what the client sends and answers on
 * demand, so each test controls exactly what the channel delivered.
 */
function createFakeTransport(
  options: FakeTransportOptions = {},
): FakeTransport {
  const { onSend } = options;
  const sent: Array<SentMessage> = [];
  const requestIds = new Map<string, string | number>();
  const held = new Map<
    string,
    { readonly resolve: () => void; readonly reject: (error: Error) => void }
  >();
  const calls = { start: 0, close: 0 };
  const transport: FakeTransport = {
    protocolVersion: undefined,
    start(): Promise<void> {
      calls.start += 1;
      return Promise.resolve();
    },
    send(
      message: JSONRPCMessage,
      sendOptions?: MCPTransportSendOptions,
    ): Promise<void> {
      sent.push({ message, options: sendOptions });
      const failure = onSend?.(message);
      if (failure !== undefined) return Promise.reject(failure);
      // A notification is told to every listener at once, so it cannot be held.
      if (!('method' in message) || !('id' in message)) {
        return Promise.resolve();
      }
      requestIds.set(message.method, message.id);
      return new Promise<void>((resolve, reject) => {
        held.set(message.method, { resolve, reject });
      });
    },
    close(): Promise<void> {
      calls.close += 1;
      return Promise.resolve();
    },
    setProtocolVersion(version: string): void {
      transport.protocolVersion = version;
    },
    sent,
    calls,
    answer(method: string, result: UnknownRecord): void {
      const id = requestIds.get(method);
      if (id === undefined) {
        throw new Error(`The client never sent a ${method} request.`);
      }
      transport.onmessage?.(
        validateJSONRPCMessage({ jsonrpc: '2.0', id, result }),
      );
    },
    fail(method: string, error: Error): void {
      const pending = held.get(method);
      if (pending === undefined) {
        throw new Error(`The client never sent a ${method} request.`);
      }
      held.delete(method);
      pending.reject(error);
    },
  };
  return transport;
}

function hasSent(transport: FakeTransport, method: string): boolean {
  return transport.sent.some(
    ({ message }) => 'method' in message && message.method === method,
  );
}

function initializeResult(protocolVersion: string): UnknownRecord {
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: 'machine-server', version: '1.0.0' },
  };
}

const DEPLOY_TOOL: UnknownRecord = {
  name: 'deploy',
  description: 'Deploy the app.',
  inputSchema: { type: 'object', properties: {} },
};

/** Connects a client over `transport` and completes its handshake. */
async function connectTransportClient(
  transport: FakeTransport,
  overrides: {
    readonly protectedValues?: () => ReadonlyArray<string>;
    readonly unavailable?: () => boolean;
    readonly signal?: AbortSignal;
  } = {},
): Promise<McpServerClient> {
  const connecting = McpServerClient.connectTransport({
    serverId: 'machine-storybook',
    transport,
    ...overrides,
  });
  await vi.waitFor(() => expect(hasSent(transport, 'initialize')).toBe(true));
  transport.answer('initialize', initializeResult('2025-06-18'));
  return connecting;
}

/** Discovers the tools the server behind `transport` declares. */
async function discoverTools(
  transport: FakeTransport,
  client: McpServerClient,
  tools: ReadonlyArray<UnknownRecord>,
): Promise<McpDiscoveryResult> {
  const discovering = client.discover();
  await vi.waitFor(() => expect(hasSent(transport, 'tools/list')).toBe(true));
  transport.answer('tools/list', { tools: [...tools] });
  return discovering;
}

/** Runs `tool` while the test answers its `tools/call` request. */
async function callTool(
  transport: FakeTransport,
  toolCall: Promise<McpCallOutcome>,
  result: UnknownRecord,
): Promise<McpCallOutcome> {
  await vi.waitFor(() => expect(hasSent(transport, 'tools/call')).toBe(true));
  transport.answer('tools/call', result);
  return toolCall;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('McpServerClient.connectTransport', () => {
  it('hands the handshake its own abort signal and fails a caller abort as cancelled', async () => {
    const transport = createFakeTransport();
    const controller = new AbortController();
    const connecting = McpServerClient.connectTransport({
      serverId: 'machine-storybook',
      transport,
      signal: controller.signal,
    });
    const settled = connecting.catch((error: unknown) => error);
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));

    const initialize = transport.sent[0];
    expect(initialize.message).toMatchObject({ method: 'initialize' });
    expect(initialize.options?.signal).toBeInstanceOf(AbortSignal);
    expect(initialize.options?.signal?.aborted).toBe(false);

    controller.abort();

    expect(initialize.options?.signal?.aborted).toBe(true);
    await expect(settled).resolves.toMatchObject({
      name: 'McpServerOperationError',
      stage: 'initialize',
      kind: 'cancelled',
      disposition: 'reconnect',
    });
    expect(transport.calls.close).toBeGreaterThan(0);
  });

  it('fails a handshake that outlives the deadline as a timeout', async () => {
    vi.useFakeTimers();
    const transport = createFakeTransport();
    const connecting = McpServerClient.connectTransport({
      serverId: 'machine-storybook',
      transport,
    });
    const settled = connecting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DISCOVERY_DEADLINE_MS);
    // A client that ignored its deadline would still be awaiting the
    // handshake; failing the send, as a closed channel does, ends it so the
    // assertion below decides rather than a wait that never ends.
    transport.fail('initialize', new Error('the Machine never answered'));

    await expect(settled).resolves.toMatchObject({
      name: 'McpServerOperationError',
      stage: 'initialize',
      kind: 'timeout',
      message: 'MCP initialize failed.',
      disposition: 'reconnect',
    });
    expect(transport.calls.close).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the handshake deadline once the handshake settled', async () => {
    vi.useFakeTimers();
    const transport = createFakeTransport();
    const connecting = McpServerClient.connectTransport({
      serverId: 'machine-storybook',
      transport,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent).toHaveLength(1);
    // The handshake is still in flight, so its deadline is armed.
    expect(vi.getTimerCount()).toBe(1);

    transport.answer('initialize', initializeResult('2025-06-18'));
    const client = await connecting;

    expect(transport.calls.close).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await client.close();
  });

  it('refuses a revision the SDK accepts but llame does not', async () => {
    const transport = createFakeTransport();
    const connecting = McpServerClient.connectTransport({
      serverId: 'machine-storybook',
      transport,
    });
    const settled = connecting.catch((error: unknown) => error);
    await vi.waitFor(() => expect(hasSent(transport, 'initialize')).toBe(true));

    transport.answer('initialize', initializeResult('2024-11-05'));

    await expect(settled).resolves.toBeInstanceOf(McpProtocolUnsupportedError);
    expect(transport.calls.close).toBeGreaterThan(0);
  });

  it.each(MCP_SERVER_CLIENT_PROTOCOL_VERSIONS)(
    'accepts the negotiated revision %s',
    async (protocolVersion) => {
      const transport = createFakeTransport();
      const connecting = McpServerClient.connectTransport({
        serverId: 'machine-storybook',
        transport,
      });
      await vi.waitFor(() =>
        expect(hasSent(transport, 'initialize')).toBe(true),
      );

      transport.answer('initialize', initializeResult(protocolVersion));
      const client = await connecting;

      // The handshake completed, so the SDK reported its revision to the transport.
      expect(transport.protocolVersion).toBe(protocolVersion);
      await expect(discoverTools(transport, client, [])).resolves.toEqual({
        tools: [],
        refused: [],
      });
      await client.close();
    },
  );

  it('reports a call on a lost channel as machine_unavailable', async () => {
    const transport = createFakeTransport({
      onSend: (message) =>
        'method' in message && message.method === 'tools/call'
          ? new Error('The Machine Workspace MCP channel is closed.')
          : undefined,
    });
    const client = await connectTransportClient(transport, {
      unavailable: () => true,
    });
    const discovery = await discoverTools(transport, client, [DEPLOY_TOOL]);

    const outcome = await discovery.tools[0].execute(
      {},
      { toolCallId: 'call-1', messages: [] },
    );

    expect(outcome).toEqual({
      disposition: 'reconnect',
      result: {
        status: 'error',
        type: 'machine_unavailable',
        message:
          'The Machine hosting this tool is unavailable, so the call may not have run.',
      },
    });
    await client.close();
  });

  it('classifies a call on a reachable channel as an ordinary failure', async () => {
    const transport = createFakeTransport({
      onSend: (message) =>
        'method' in message && message.method === 'tools/call'
          ? new Error('The server refused the call.')
          : undefined,
    });
    const client = await connectTransportClient(transport, {
      unavailable: () => false,
    });
    const discovery = await discoverTools(transport, client, [DEPLOY_TOOL]);

    const outcome = await discovery.tools[0].execute(
      {},
      { toolCallId: 'call-1', messages: [] },
    );

    expect(outcome).toEqual({
      disposition: 'reconnect',
      result: {
        status: 'error',
        type: 'execution_failed',
        message: 'The remote tool failed to execute.',
      },
    });
    await client.close();
  });

  it('redacts the values the transport reports, and no value it does not', async () => {
    const reported = 'machine-session-sentinel';
    const transport = createFakeTransport();
    const client = await connectTransportClient(transport, {
      protectedValues: () => [reported],
    });
    const discovery = await discoverTools(transport, client, [DEPLOY_TOOL]);

    const outcome = await callTool(
      transport,
      discovery.tools[0].execute({}, { toolCallId: 'call-1', messages: [] }),
      {
        content: [
          { type: 'text', text: `bearer ${reported} and Stryker was here` },
        ],
      },
    );

    expect(outcome).toEqual({
      disposition: 'none',
      result: {
        status: 'success',
        output: {
          content: [
            {
              type: 'text',
              text: `bearer ${PROTECTED_VALUE_REDACTION_MARKER} and Stryker was here`,
            },
          ],
          // The SDK normalizes a call result's failure flag onto the payload.
          isError: false,
        },
      },
    });
    await client.close();
  });
});
