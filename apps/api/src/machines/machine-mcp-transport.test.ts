import type { JSONRPCMessage } from '@ai-sdk/mcp';
import { type JsonRpcNotification } from '@workspace/machine-protocol';

import {
  createProtocolPeer,
  type PeerSession,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';

import { MachineConnector } from './machine-connector.service';
import {
  MachineTransport,
  type MachineMcpTransportOptions,
} from './machine-mcp-transport';
import { MachineUnavailableError } from './machine-session';

const ENVELOPE = { budgetMs: 30_000 };

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

const START_VALUE = 'repo-token-sentinel';
const LEARNED_VALUE = 'session-id-sentinel';

type HubNotification = Readonly<{
  method: string;
  notification: JsonRpcNotification;
}>;

type Fixture = Readonly<{
  connector: MachineConnector;
  peer: ReturnType<typeof createProtocolPeer>;
  /** Every notification the hub sent on a request stream, in arrival order. */
  hubNotifications: ReadonlyArray<HubNotification>;
}>;

function fixture(options: ProtocolPeerOptions = {}): Fixture {
  const hubNotifications: Array<HubNotification> = [];
  const peer = createProtocolPeer({
    roots: ['/srv/work'],
    ...options,
    onNotification: (method, notification) => {
      hubNotifications.push({ method, notification });
      options.onNotification?.(method, notification);
    },
    answers: {
      'mcp.open': { hold: true },
      ...options.answers,
    },
  });
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    transportFactory: peer.factory,
    handshakeTimeoutMs: 2000,
  });
  return { connector, peer, hubNotifications };
}

type OpenedTransport = Readonly<{
  transport: MachineTransport;
  session: PeerSession;
  diagnostics: ReadonlyArray<string>;
  messages: ReadonlyArray<JSONRPCMessage>;
  hubNotifications: ReadonlyArray<HubNotification>;
}>;

/** Opens one relayed channel and answers `mcp.open` with `protectedValues`. */
async function opened(
  { connector, peer, hubNotifications }: Fixture,
  overrides: Partial<MachineMcpTransportOptions> = {},
): Promise<OpenedTransport> {
  const diagnostics: Array<string> = [];
  const messages: Array<JSONRPCMessage> = [];
  const transport = new MachineTransport({
    connector,
    machine: 'devl',
    root: '/srv/work',
    server: 'storybook',
    envelope: ENVELOPE,
    onDiagnostic: (text) => diagnostics.push(text),
    ...overrides,
  });
  transport.onmessage = (message) => messages.push(message);
  const started = transport.start();
  const session = await peer.session(0);
  await session.awaitRequests(1);
  session.release('mcp.open', { protectedValues: [START_VALUE] }, true);
  await started;
  return { transport, session, diagnostics, messages, hubNotifications };
}

describe('MachineTransport', () => {
  it('asks the Machine for the server and keeps its protected values', async () => {
    const openedTransport = await opened(fixture());

    expect(openedTransport.session.requests).toEqual(['mcp.open']);
    expect(openedTransport.transport.protectedValues()).toEqual([START_VALUE]);
    expect(openedTransport.transport.lost).toBe(false);
    await openedTransport.transport.close();
  });

  it('takes later-learned values as secrets too', async () => {
    const openedTransport = await opened(fixture());

    openedTransport.session.notify('mcp.open', 'mcp.protected', {
      values: [LEARNED_VALUE],
    });

    expect(openedTransport.transport.protectedValues()).toEqual([
      START_VALUE,
      LEARNED_VALUE,
    ]);
    await openedTransport.transport.close();
  });

  it('relays one message in each direction over the channel', async () => {
    const openedTransport = await opened(fixture());

    const inbound = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
    openedTransport.session.notify('mcp.open', 'mcp.message', {
      message: inbound,
    });
    expect(openedTransport.messages).toEqual([inbound]);

    await openedTransport.transport.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: { cursor: 'next' },
    });
    expect(openedTransport.hubNotifications).toEqual([
      {
        method: 'mcp.open',
        notification: {
          jsonrpc: '2.0',
          method: 'mcp.message',
          params: {
            message: {
              jsonrpc: '2.0',
              id: 7,
              method: 'tools/list',
              params: { cursor: 'next' },
            },
          },
        },
      },
    ]);
    await openedTransport.transport.close();
  });

  it('tells the Machine which revision the handshake negotiated', async () => {
    const openedTransport = await opened(fixture());

    openedTransport.transport.setProtocolVersion('2025-06-18');

    expect(openedTransport.transport.protocolVersion).toBe('2025-06-18');
    expect(openedTransport.hubNotifications).toEqual([
      {
        method: 'mcp.open',
        notification: {
          jsonrpc: '2.0',
          method: 'mcp.setProtocolVersion',
          params: { version: '2025-06-18' },
        },
      },
    ]);
    await openedTransport.transport.close();
  });

  it('redacts and bounds the diagnostics the Machine relays', async () => {
    const openedTransport = await opened(fixture());
    const session = openedTransport.session;

    session.notify('mcp.open', 'mcp.stderr', {
      text: `starting with ${START_VALUE}\n`,
    });
    session.notify('mcp.open', 'mcp.protected', { values: [LEARNED_VALUE] });
    session.notify('mcp.open', 'mcp.stderr', {
      text: `connected as ${LEARNED_VALUE}\n`,
    });

    const emitted = openedTransport.diagnostics.join('\n');
    expect(emitted).toContain('[REDACTED]');
    expect(emitted).not.toContain(START_VALUE);
    expect(emitted).not.toContain(LEARNED_VALUE);

    for (let index = 0; index < 200; index += 1) {
      session.notify('mcp.open', 'mcp.stderr', {
        text: `${'x'.repeat(1024)}\n`,
      });
    }
    expect(openedTransport.diagnostics.join('').length).toBeLessThan(64 * 1024);
    await openedTransport.transport.close();
  });

  it('treats a lost channel as a crashed server', async () => {
    const openedTransport = await opened(fixture());
    const closed = vi.fn();
    const failed = vi.fn();
    openedTransport.transport.onclose = closed;
    openedTransport.transport.onerror = failed;

    openedTransport.session.drop();

    await vi.waitFor(() => expect(openedTransport.transport.lost).toBe(true));
    expect(closed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'The Machine closed this Workspace MCP channel.',
      }),
    );
    await expect(
      openedTransport.transport.send({ jsonrpc: '2.0', method: 'ping' }),
    ).rejects.toThrow('closed');
  });

  it('treats an unusable relayed message as a lost server', async () => {
    const openedTransport = await opened(fixture());
    const closed = vi.fn();
    const failed = vi.fn();
    openedTransport.transport.onclose = closed;
    openedTransport.transport.onerror = failed;

    openedTransport.session.notify('mcp.open', 'mcp.message', {
      message: { not: 'a JSON-RPC message' },
    });

    expect(openedTransport.transport.lost).toBe(true);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'The Machine relayed a message that is not a JSON-RPC message.',
      }),
    );
    expect(closed).toHaveBeenCalledOnce();
    // The Machine is told to put down the server it started for the channel.
    await vi.waitFor(() => expect(openedTransport.session.openStreams).toBe(0));
  });

  it('ignores a notification the Machine relays under an unknown method', async () => {
    const openedTransport = await opened(fixture());
    const closed = vi.fn();
    openedTransport.transport.onclose = closed;

    openedTransport.session.notify('mcp.open', 'machine.somethingElse', {
      anything: true,
    });

    expect(openedTransport.messages).toEqual([]);
    expect(closed).not.toHaveBeenCalled();
    expect(openedTransport.transport.lost).toBe(false);
    await openedTransport.transport.close();
  });

  it('ignores protected-value notifications that carry no usable values', async () => {
    const openedTransport = await opened(fixture());

    // A non-record payload, a value list that is not a list at all, and one
    // whose entries are not all strings: none of them names a secret.
    openedTransport.session.notify('mcp.open', 'mcp.protected', 'not-a-record');
    openedTransport.session.notify('mcp.open', 'mcp.protected', {
      values: 'not-a-list',
    });
    openedTransport.session.notify('mcp.open', 'mcp.protected', {
      values: ['not-a-secret', 7],
    });

    expect(openedTransport.transport.protectedValues()).toEqual([START_VALUE]);
    expect(openedTransport.transport.lost).toBe(false);
    await openedTransport.transport.close();
  });

  it('keeps a half-written diagnostic line buffered across a protected notification with no values', async () => {
    const openedTransport = await opened(fixture());

    openedTransport.session.notify('mcp.open', 'mcp.stderr', {
      text: `starting with ${START_VALUE}`,
    });
    // No terminator yet, so nothing has been released.
    expect(openedTransport.diagnostics).toEqual([]);
    openedTransport.session.notify('mcp.open', 'mcp.protected', {
      values: ['not-a-secret', 7],
    });
    openedTransport.session.notify('mcp.open', 'mcp.stderr', {
      text: ' and running\n',
    });

    expect(openedTransport.diagnostics).toEqual([
      'starting with [REDACTED] and running',
    ]);
    await openedTransport.transport.close();
  });

  it('ignores a diagnostic notification that carries no text', async () => {
    const openedTransport = await opened(fixture());

    openedTransport.session.notify('mcp.open', 'mcp.stderr', 'not-a-record');
    openedTransport.session.notify('mcp.open', 'mcp.stderr', { text: 7 });

    expect(openedTransport.diagnostics).toEqual([]);
    await openedTransport.transport.close();
  });

  it('keeps a protocol version set before the channel exists', () => {
    const { connector, peer } = fixture();
    const transport = new MachineTransport({
      connector,
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      envelope: ENVELOPE,
    });

    transport.setProtocolVersion('2025-06-18');

    expect(transport.protocolVersion).toBe('2025-06-18');
    expect(peer.sessions).toHaveLength(0);
  });

  it('relays nested arrays and scalars as JSON', async () => {
    const openedTransport = await opened(fixture());

    await openedTransport.transport.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'x', limit: 2, tags: ['a', 'b'] },
        stream: false,
        cursor: null,
      },
    });

    expect(openedTransport.hubNotifications).toEqual([
      {
        method: 'mcp.open',
        notification: {
          jsonrpc: '2.0',
          method: 'mcp.message',
          params: {
            message: {
              jsonrpc: '2.0',
              id: 7,
              method: 'tools/call',
              params: {
                name: 'search',
                arguments: { query: 'x', limit: 2, tags: ['a', 'b'] },
                stream: false,
                cursor: null,
              },
            },
          },
        },
      },
    ]);
    await openedTransport.transport.close();
  });

  it('refuses to relay a message that is not a JSON value', async () => {
    const openedTransport = await opened(fixture());

    expect(() =>
      openedTransport.transport.send({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { when: () => undefined },
      }),
    ).toThrow('The message is not a JSON value.');
    expect(openedTransport.hubNotifications).toEqual([]);
    await openedTransport.transport.close();
  });

  it('fails the start on an unusable mcp.open answer', async () => {
    const { connector, peer } = fixture();
    const failed = vi.fn();
    const closed = vi.fn();
    const transport = new MachineTransport({
      connector,
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      envelope: ENVELOPE,
    });
    transport.onerror = failed;
    transport.onclose = closed;

    const started = transport.start();
    const session = await peer.session(0);
    await session.awaitRequests(1);
    session.release('mcp.open', { nope: true });

    await expect(started).rejects.toThrow(
      'The Machine answered an unusable mcp.open result.',
    );
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'The Machine answered an unusable mcp.open result.',
      }),
    );
    expect(closed).toHaveBeenCalledOnce();
    expect(transport.lost).toBe(true);
  });

  it('treats a channel the Machine ends before answering mcp.open as a failed start', async () => {
    const { connector, peer } = fixture();
    const failed = vi.fn();
    const closed = vi.fn();
    const transport = new MachineTransport({
      connector,
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      envelope: ENVELOPE,
    });
    transport.onerror = failed;
    transport.onclose = closed;

    const started = transport.start();
    const session = await peer.session(0);
    await session.awaitRequests(1);
    // The link is gone before the Machine ever answered `mcp.open`: the
    // channel was never the MCP client's, so this is a failed start, not a
    // server that crashed under it.
    session.drop();

    await expect(started).rejects.toBeInstanceOf(MachineUnavailableError);
    expect(closed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(transport.lost).toBe(false);
  });

  it('passes the caller signal to the channel it opens', async () => {
    const { connector } = fixture();
    const controller = new AbortController();
    controller.abort();
    const transport = new MachineTransport({
      connector,
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      envelope: ENVELOPE,
      signal: controller.signal,
    });

    // A pre-aborted signal must reach the connector, which refuses to open a
    // session for a call nobody wants.
    await expect(transport.start()).rejects.toThrow(/abort/i);
  });

  it('refuses to start once llame closed the transport', async () => {
    const { connector } = fixture();
    const transport = new MachineTransport({
      connector,
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      envelope: ENVELOPE,
    });

    await transport.close();

    await expect(transport.start()).rejects.toThrow(
      'The Machine Workspace MCP transport is closed.',
    );
  });

  it('opens one channel however often the transport is started', async () => {
    const peerFixture = fixture();
    const openedTransport = await opened(peerFixture);

    await expect(openedTransport.transport.start()).resolves.toBeUndefined();

    expect(peerFixture.peer.sessions).toHaveLength(1);
    expect(openedTransport.session.requests).toEqual(['mcp.open']);
    await openedTransport.transport.close();
  });

  it('cancels the channel when llame closes it, and reports no loss', async () => {
    const openedTransport = await opened(fixture());
    const closed = vi.fn();
    openedTransport.transport.onclose = closed;

    await openedTransport.transport.close();

    expect(closed).not.toHaveBeenCalled();
    expect(openedTransport.transport.lost).toBe(false);
    // `cancel` is how the Machine is told to put the server down.
    await vi.waitFor(() => expect(openedTransport.session.openStreams).toBe(0));
  });
});
