import { afterEach, describe, expect, it } from 'vitest';

import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from '@workspace/runtime-safety';
import {
  type JsonValue,
  type McpServerEntry,
} from '@workspace/machine-protocol';

import { MachineConnector } from '../machines/machine-connector.service';
import { DEFAULT_REQUEST_BUDGET_MS } from '../machines/machine-session';
import {
  createProtocolPeer,
  type PeerSession,
  type ProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import {
  machineServerClientFactory,
  machineWorkspaceTarget,
  readMachineServerConfigs,
  unavailableConfig,
  unavailableWorkspaceConfig,
  type WorkspaceServerConfig,
} from './machine-workspace-servers';
import { type McpMachineRuntimeDefinition } from './mcp-server-client';

/** Machine names as the operator configuration declares them. */
const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

const TARGET = { machine: 'devl', path: '/srv/work' };

/** Every connector a test opened, closed after it so no session outlives it. */
const connectors: Array<MachineConnector> = [];

afterEach(() => {
  for (const connector of connectors) connector.onModuleDestroy();
  connectors.length = 0;
});

type Fixture = Readonly<{
  connector: MachineConnector;
  peer: ProtocolPeer;
  /** The session the hub opened, for reading the requests it sent. */
  latest: () => PeerSession | undefined;
}>;

/** A real connector over the protocol peer, so every request is llame's own. */
function fixture(options: ProtocolPeerOptions = {}): Fixture {
  let latest: PeerSession | undefined;
  const peer = createProtocolPeer({ roots: ['/srv/work'], ...options });
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    handshakeTimeoutMs: 2000,
    transportFactory: {
      open: (openOptions) => {
        const transport = peer.factory.open(openOptions);
        latest = peer.sessions.at(-1);
        return transport;
      },
    },
  });
  connectors.push(connector);
  return { connector, peer, latest: () => latest };
}

function serversAnswer(
  servers: ReadonlyArray<McpServerEntry>,
): ProtocolPeerOptions {
  return { answers: { 'mcp.servers': { value: { servers: [...servers] } } } };
}

/** A configured Machine server's own definition, or a test failure. */
function machineDefinition(
  config: WorkspaceServerConfig,
): McpMachineRuntimeDefinition {
  if (
    config.state !== 'configured' ||
    config.definition.transport !== 'machine'
  ) {
    throw new Error(
      `Expected a configured Machine server, got ${JSON.stringify(config)}`,
    );
  }
  return config.definition;
}

describe('machineWorkspaceTarget', () => {
  it('names the Machine and path a Workspace root holds', () => {
    expect(machineWorkspaceTarget('machine://devl/srv/work')).toEqual({
      machine: 'devl',
      path: '/srv/work',
    });
    // The scheme and name canonicalize; the path decodes exactly once.
    expect(machineWorkspaceTarget('MACHINE://Devl/srv/wo%20rks')).toEqual({
      machine: 'devl',
      path: '/srv/wo rks',
    });
  });

  it('refuses a locator that names no path', () => {
    expect(machineWorkspaceTarget('machine://devl')).toBeUndefined();
    expect(machineWorkspaceTarget('machine://')).toBeUndefined();
  });

  it('refuses a locator that carries a read selector', () => {
    expect(
      machineWorkspaceTarget('machine://devl/srv/work/README.md:1-5'),
    ).toBeUndefined();
  });

  it('refuses a local path and an invalid locator', () => {
    expect(machineWorkspaceTarget('/srv/work')).toBeUndefined();
    expect(machineWorkspaceTarget('machine:///srv/work')).toBeUndefined();
  });
});

describe('readMachineServerConfigs', () => {
  it('reports an unconfigured Machine without asking it anything', async () => {
    const { connector, peer } = fixture();

    const configs = await readMachineServerConfigs(connector, {
      machine: 'other',
      path: '/srv/work',
    });

    expect(configs).toEqual([
      {
        id: 'workspace',
        state: 'unavailable',
        reason: 'This Machine is not configured.',
      },
    ]);
    expect(peer.sessions).toHaveLength(0);
  });

  it('reports an unconfigured Machine when the connector is absent', async () => {
    const configs = await readMachineServerConfigs(undefined, TARGET);

    expect(configs).toEqual([
      unavailableConfig('workspace', 'This Machine is not configured.'),
    ]);
  });

  it('asks the Machine for the Workspace and holds its answer', async () => {
    const { connector, latest } = fixture(
      serversAnswer([
        { name: 'storybook', state: 'available', transport: 'stdio' },
      ]),
    );

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([
      {
        id: 'storybook',
        state: 'configured',
        definition: {
          transport: 'machine',
          machine: 'devl',
          root: '/srv/work',
          server: 'storybook',
          kind: 'stdio',
        },
        protectedValues: [],
      },
    ]);
    expect(latest()?.calls).toEqual([
      {
        method: 'mcp.servers',
        params: {
          envelope: { budgetMs: DEFAULT_REQUEST_BUDGET_MS },
          root: '/srv/work',
        },
      },
    ]);
  });

  it('keeps the Machine order and the transport it resolved for each server', async () => {
    const { connector } = fixture(
      serversAnswer([
        { name: 'zeta', state: 'available', transport: 'http' },
        { name: 'alpha', state: 'available', transport: 'stdio' },
      ]),
    );

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs.map((config) => machineDefinition(config).kind)).toEqual([
      'http',
      'stdio',
    ]);
    expect(configs.map((config) => config.id)).toEqual(['zeta', 'alpha']);
  });

  it('contributes nothing when the Workspace declares no server', async () => {
    const { connector } = fixture(serversAnswer([]));

    await expect(readMachineServerConfigs(connector, TARGET)).resolves.toEqual(
      [],
    );
  });

  it('keeps the Machine diagnostic of a server it could not resolve', async () => {
    const { connector } = fixture(
      serversAnswer([
        {
          name: 'storybook',
          state: 'unavailable',
          diagnostic: '{env:TOKEN} is not set on this Machine',
        },
      ]),
    );

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([
      {
        id: 'storybook',
        state: 'unavailable',
        reason: '{env:TOKEN} is not set on this Machine',
      },
    ]);
  });

  it('reports an available server whose transport stayed unknown', async () => {
    const { connector } = fixture(
      serversAnswer([{ name: 'storybook', state: 'available' }]),
    );

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([
      {
        id: 'storybook',
        state: 'unavailable',
        reason: "the server's transport is unknown",
      },
    ]);
  });

  it('keeps a Machine server unavailable even when its transport is known', async () => {
    const { connector } = fixture(
      serversAnswer([
        {
          name: 'storybook',
          state: 'unavailable',
          transport: 'stdio',
          diagnostic: 'the command exited with code 1',
        },
      ]),
    );

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([
      {
        id: 'storybook',
        state: 'unavailable',
        reason: 'the command exited with code 1',
      },
    ]);
  });

  it('reports an unusable configuration without dropping the Workspace', async () => {
    const { connector } = fixture({
      answers: {
        'mcp.servers': { value: { servers: [{ name: 'storybook' }] } },
      },
    });

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([
      {
        id: 'workspace',
        state: 'unavailable',
        reason: 'The Machine answered an unusable MCP configuration',
      },
    ]);
  });

  it('reports a failed configuration read as one unavailable entry', async () => {
    const { connector } = fixture({
      answers: { 'mcp.servers': { error: 'internal' } },
    });

    const configs = await readMachineServerConfigs(connector, TARGET);

    expect(configs).toEqual([unavailableWorkspaceConfig()]);
    expect(configs).toEqual([
      {
        id: 'workspace',
        state: 'unavailable',
        reason: 'Workspace MCP configuration unavailable',
      },
    ]);
  });
});

type JsonRpcCall = Readonly<{ id: JsonValue; method: string }>;

/** The holder the fixture keeps the hub's newest session in. */
type SessionHolder = { current?: PeerSession };

/** One JSON-RPC field of a relayed notification, if it is a JSON value. */
function field(
  params: JsonValue | undefined,
  key: string,
): JsonValue | undefined {
  if (!isRecord(params)) return undefined;
  const value = params[key];
  if (isRecord(value)) return value;
  if (value === null) return value;
  if (isString(value)) return value;
  if (isNumber(value)) return value;
  if (isBoolean(value)) return value;
  return undefined;
}

function jsonRpcCall(message: JsonValue | undefined): JsonRpcCall | undefined {
  if (!isRecord(message)) return undefined;
  const id = message['id'];
  const method = message['method'];
  if (!isString(method) || (!isString(id) && !isNumber(id))) return undefined;
  return { id, method };
}

/**
 * A Machine whose Workspace declares one MCP server, answered over the relayed
 * channel exactly as the daemon relays the real server it started.
 */
function mcpServerFixture(): Fixture {
  const latestSession: SessionHolder = {};
  const peer = createProtocolPeer({
    roots: ['/srv/work'],
    answers: { 'mcp.open': { hold: true } },
    onNotification: (method, notification) => {
      if (method !== 'mcp.open') return;
      if (notification.method !== 'mcp.message') return;
      const call = jsonRpcCall(field(notification.params, 'message'));
      if (call === undefined) return;
      const answer: JsonValue | undefined =
        call.method === 'initialize'
          ? {
              jsonrpc: '2.0',
              id: call.id,
              result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'machine-server', version: '1.0.0' },
              },
            }
          : call.method === 'tools/list'
            ? {
                jsonrpc: '2.0',
                id: call.id,
                result: {
                  tools: [
                    {
                      name: 'deploy',
                      description: 'Deploy the app.',
                      inputSchema: { type: 'object', properties: {} },
                    },
                  ],
                },
              }
            : undefined;
      if (answer === undefined) return;
      latestSession.current?.notify('mcp.open', 'mcp.message', {
        message: answer,
      });
    },
  });
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    handshakeTimeoutMs: 2000,
    transportFactory: {
      open: (openOptions) => {
        const transport = peer.factory.open(openOptions);
        latestSession.current = peer.sessions.at(-1);
        return transport;
      },
    },
  });
  connectors.push(connector);
  return { connector, peer, latest: () => latestSession.current };
}

describe('machineServerClientFactory', () => {
  it('refuses to build a Machine server client without the connector', async () => {
    const factory = machineServerClientFactory(undefined, TARGET);

    await expect(
      factory({
        transport: 'machine',
        serverId: 'machine-storybook',
        machine: 'devl',
        root: '/srv/work',
        server: 'storybook',
        kind: 'stdio',
      }),
    ).rejects.toThrow('Machine MCP servers need the Machine connector.');
  });

  it('opens the named server on the Machine and discovers its tools', async () => {
    const machine = mcpServerFixture();
    const factory = machineServerClientFactory(machine.connector, TARGET);

    const connecting = factory({
      transport: 'machine',
      serverId: 'machine-storybook',
      machine: 'devl',
      root: '/srv/work',
      server: 'storybook',
      kind: 'stdio',
    });
    const session = await machine.peer.session(0);
    await session.awaitRequests(1);
    expect(session.calls).toEqual([
      {
        method: 'mcp.open',
        params: {
          envelope: { budgetMs: DEFAULT_REQUEST_BUDGET_MS },
          root: '/srv/work',
          server: 'storybook',
        },
      },
    ]);
    session.release('mcp.open', { protectedValues: ['repo-token'] }, true);

    const client = await connecting;
    try {
      const discovery = await client.discover();
      expect(discovery.tools.map((entry) => entry.definition.id)).toEqual([
        'mcp__machine-storybook__deploy',
      ]);
    } finally {
      await client.close();
    }
  });
});
