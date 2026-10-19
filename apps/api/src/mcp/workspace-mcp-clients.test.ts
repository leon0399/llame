import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
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
import {
  createProtocolPeer,
  type PeerSession,
} from '../testing/machine-protocol-peer';
import { MachineConnector } from '../machines/machine-connector.service';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type ModelToolDeclaration } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import {
  constrainDynamicToolResolver,
  resolveBoundExecutableTools,
} from '../runs/snapshot-tool-execution';
import { type McpDiscoveryResult } from './mcp-server-client';
import {
  McpRuntimeService,
  type McpRuntimeClient,
} from './mcp-runtime.service';
import {
  WorkspaceMcpClients,
  type WorkspaceMcpEntryState,
  type WorkspaceMcpKey,
} from './workspace-mcp-clients';
import { type WorkspaceMcpServerConfig } from '@workspace/mcp-workspace';
import {
  AttemptToolAdditions,
  type AttemptToolBinding,
} from '../tools/attempt-tool-additions';
import { type Tool, type ToolContext } from '../tools/types';
const emptySchema = { type: 'object', properties: {} };

type FakeClient = McpRuntimeClient & {
  readonly discover: ReturnType<typeof vi.fn<McpRuntimeClient['discover']>>;
  readonly close: ReturnType<typeof vi.fn<McpRuntimeClient['close']>>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Deferred resolver missing.');
  return { promise, resolve };
}
function discoveredTool(serverId: string, label: string) {
  return {
    definition: {
      id: `mcp__${serverId}__search`,
      remoteName: 'search',
      description: `Search ${label}.`,
      inputSchema: emptySchema,
    },
    execute: vi.fn(() =>
      Promise.resolve({
        disposition: 'none' as const,
        result: { status: 'success' as const, output: label },
      }),
    ),
  };
}

function client(serverId: string, label: string): FakeClient {
  const discovered = discoveredTool(serverId, label);
  const discover = vi.fn<McpRuntimeClient['discover']>(() =>
    Promise.resolve({
      tools: [discovered],
      refused: [],
    } satisfies McpDiscoveryResult),
  );
  const close = vi.fn<McpRuntimeClient['close']>(() => Promise.resolve());
  return { discover, close };
}

function config(id: string, label: string): WorkspaceMcpServerConfig {
  return {
    id,
    state: 'configured',
    definition: { url: `https://${label}.example.test/mcp` },
    protectedValues: [],
  };
}

function key(chatId: string, root: string, generation = 1): WorkspaceMcpKey {
  return { chatId, root, generation };
}

function additions(binding?: AttemptToolBinding): AttemptToolAdditions {
  const boundExecutables = new Map<string, AttemptToolBinding>();
  if (binding !== undefined)
    boundExecutables.set(binding.declaration.id, binding);
  return new AttemptToolAdditions({
    allowedToolRules: ['mcp__web__*'],
    callTimeoutSeconds: 120,
    boundExecutables,
    createTool: () => ({
      id: 'placeholder',
      description: 'placeholder',
      classification: 'unverified',
      inputSchema: z.object({}),
    }),
  });
}

type RuntimeFixture = {
  runtime: McpRuntimeService;
  clients: Array<FakeClient>;
};

type WorkspaceFixture = {
  provider: WorkspaceMcpClients;
  clients: Array<FakeClient>;
};

function operatorRuntime(serverId?: string): RuntimeFixture {
  const clients: Array<FakeClient> = [];
  const runtime = new McpRuntimeService(
    serverId === undefined
      ? {}
      : { [serverId]: { url: `https://operator-${serverId}.test/mcp` } },
    {
      clientFactory: (_input) => {
        const created = client(serverId ?? 'operator', 'operator');
        clients.push(created);
        return Promise.resolve(created);
      },
    },
  );
  return { runtime, clients };
}

function workspaceProvider(
  operator: McpRuntimeService,
  configs: (root: string) => ReadonlyArray<WorkspaceMcpServerConfig>,
  now?: () => number,
): WorkspaceFixture {
  const clients: Array<FakeClient> = [];
  const provider = new WorkspaceMcpClients(operator, {
    now,
    readConfig: (root) => Promise.resolve(configs(root)),
    clientFactory: (input) => {
      const serverId = input.serverId;
      const label = 'url' in input ? input.url.split('//')[1] : serverId;
      const created = client(serverId, label);
      clients.push(created);
      return Promise.resolve(created);
    },
  });
  return { provider, clients };
}

const fakeDb = drizzle.mock({ schema });
const tenantDb: TenantRunner = {
  runAs: <T>(_userId: string, operation: (db: Db) => Promise<T>) =>
    operation(fakeDb),
};
const toolContext: ToolContext = {
  userId: 'user-1',
  chatId: 'chat-1',
  tenantDb,
};

const declaration = (id: string): ModelToolDeclaration => ({
  id,
  description: 'Operator declaration.',
  inputSchema: emptySchema,
});

const operatorTool = (id: string): Tool => ({
  id,
  description: 'Operator tool.',
  classification: 'unverified',
  inputSchema: z.object({}),
  execute: () => ({ status: 'success' as const }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkspaceMcpClients', () => {
  it('keeps same-id clients and executors isolated between Chats', async () => {
    const { runtime } = operatorRuntime();
    const { provider } = workspaceProvider(runtime, (root) => [
      config('web', root),
    ]);
    const first = key('chat-a', '/workspace/a');
    const second = key('chat-b', '/workspace/b');

    await provider.startForChat(first);
    await provider.startForChat(second);

    const firstResolution = provider
      .resolverFor(first, undefined)
      .resolveDynamicTool('mcp__web__search');
    const secondResolution = provider
      .resolverFor(second, undefined)
      .resolveDynamicTool('mcp__web__search');
    expect(firstResolution.state).toBe('available');
    expect(secondResolution.state).toBe('available');
    if (firstResolution.state !== 'available')
      throw new Error('first unavailable');
    if (secondResolution.state !== 'available')
      throw new Error('second unavailable');

    const firstResult = await firstResolution.executor.execute(toolContext, {});
    const secondResult = await secondResolution.executor.execute(
      toolContext,
      {},
    );
    expect(JSON.stringify(firstResult)).toContain('a.example.test/mcp');
    expect(JSON.stringify(secondResult)).toContain('b.example.test/mcp');
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('stops stale generation clients before starting a current key', async () => {
    const { runtime } = operatorRuntime();
    const { provider, clients } = workspaceProvider(runtime, () => [
      config('web', 'current'),
    ]);
    const oldKey = key('chat-1', '/old', 1);
    const newKey = key('chat-1', '/new', 2);

    await provider.startForChat(oldKey);
    await provider.startForChat(newKey);

    expect(clients).toHaveLength(2);
    expect(clients[0].close).toHaveBeenCalledOnce();
    expect(provider.stateForKey(oldKey)).toBeUndefined();
    expect(provider.stateForKey(newKey)).toMatchObject({
      key: newKey,
      servers: [{ id: 'web', state: 'available' }],
    });
    await provider.onModuleDestroy();
    await runtime.stop();
  });
  it('treats generation as part of stale-key identity when the root is unchanged', async () => {
    const { runtime } = operatorRuntime();
    const { provider, clients } = workspaceProvider(runtime, () => [
      config('web', 'same-root'),
    ]);
    const oldKey = key('chat-1', '/same-root', 1);
    const newKey = key('chat-1', '/same-root', 2);
    await provider.startForChat(oldKey);
    await provider.startForChat(newKey);
    expect(clients[0]?.close).toHaveBeenCalledOnce();
    expect(provider.stateForKey(oldKey)).toBeUndefined();
    expect(provider.stateForKey(newKey)).toBeDefined();
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('reports a configuration read failure as an unavailable Workspace server', async () => {
    const { runtime } = operatorRuntime();
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () => Promise.reject(new Error('read failed')),
    });
    const state = await provider.startForChat(key('chat-1', '/unreadable'));
    expect(state.servers).toEqual([
      {
        id: 'workspace',
        state: 'unavailable',
        reason: 'Workspace MCP configuration unavailable',
      },
    ]);
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('reports an unavailable config entry without starting a client', async () => {
    const { runtime } = operatorRuntime();
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () =>
        Promise.resolve([
          {
            id: 'bad',
            state: 'unavailable' as const,
            reason: 'invalid server entry',
          },
        ]),
    });
    const state = await provider.startForChat(key('chat-1', '/bad-entry'));
    expect(state.servers).toEqual([
      { id: 'bad', state: 'unavailable', reason: 'invalid server entry' },
    ]);
    await provider.onModuleDestroy();
    await runtime.stop();
  });
  it('reuses a matching key without rereading or restarting its clients', async () => {
    const { runtime } = operatorRuntime();
    const readConfig = vi.fn(() =>
      Promise.resolve([config('web', 'same-key')]),
    );
    const clients: Array<FakeClient> = [];
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig,
      clientFactory: (input) => {
        const created = client(input.serverId, 'same-key');
        clients.push(created);
        return Promise.resolve(created);
      },
    });
    const current = key('chat-1', '/same', 1);
    await provider.startForChat(current);
    await provider.startForChat(current);
    expect(readConfig).toHaveBeenCalledOnce();
    expect(clients).toHaveLength(1);
    await provider.onModuleDestroy();
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('shares an in-flight matching start between concurrent callers', async () => {
    const { runtime } = operatorRuntime();
    const pending = deferred<FakeClient>();
    let factoryCalls = 0;
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () => Promise.resolve([config('web', 'pending')]),
      clientFactory: () => {
        factoryCalls += 1;
        return pending.promise;
      },
    });
    const current = key('chat-1', '/pending', 1);
    const first = provider.startForChat(current);
    await vi.waitFor(() => expect(factoryCalls).toBe(1));
    const second = provider.startForChat(current);
    pending.resolve(client('web', 'pending'));
    const [firstState, secondState] = await Promise.all([first, second]);
    expect(firstState.key).toEqual(current);
    expect(secondState.key).toEqual(current);
    expect(factoryCalls).toBe(1);
    await provider.onModuleDestroy();
    await runtime.stop();
  });
  it('reports each configured server from the matching runtime state', async () => {
    const { runtime } = operatorRuntime();
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () =>
        Promise.resolve([config('bad', 'bad'), config('web', 'good')]),
      clientFactory: (input) =>
        input.serverId === 'bad'
          ? Promise.reject(new Error('bad server'))
          : Promise.resolve(client(input.serverId, 'good')),
    });
    const state = await provider.startForChat(key('chat-1', '/mixed'));
    expect(state.servers).toEqual([
      { id: 'bad', state: 'unavailable', reason: 'source_disconnected' },
      { id: 'web', state: 'available' },
    ]);
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('defers byte-equal shadowing while retaining operator declarations', async () => {
    const { runtime } = operatorRuntime('web');
    await runtime.start();
    const { provider } = workspaceProvider(runtime, () => [
      config('web', 'workspace'),
    ]);
    const current = key('chat-1', '/workspace');
    await provider.startForChat(current);
    const id = 'mcp__web__search';
    const additionsHandle = additions({
      declaration: declaration(id),
      executor: operatorTool(id),
    });

    const state = await provider.addToAttempt(current, additionsHandle);
    expect(state.servers).toEqual([
      { id: 'web', state: 'available', reason: 'shadows from the next Run' },
    ]);
    const candidates = provider.snapshotCandidates(current);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: { serverId: 'web' } });
    const resolution = provider
      .resolverFor(current, runtime)
      .resolveDynamicTool(id);
    expect(resolution.state).toBe('available');
    if (resolution.state !== 'available')
      throw new Error('workspace unavailable');
    expect(resolution.executor).not.toBe(additionsHandle.executorFor(id));
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('reports case-only collisions without starting the Workspace server', async () => {
    const { runtime } = operatorRuntime('web');
    await runtime.start();
    const { provider, clients } = workspaceProvider(runtime, () => [
      config('WEB', 'workspace'),
    ]);

    const state = await provider.startForChat(key('chat-1', '/workspace'));
    expect(state.servers).toEqual([
      {
        id: 'WEB',
        state: 'unavailable',
        reason: 'case-only collision with an operator server',
      },
    ]);
    expect(clients).toHaveLength(0);
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('does not shadow an operator server when Workspace startup fails', async () => {
    const { runtime } = operatorRuntime('web');
    await runtime.start();
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () => Promise.resolve([config('web', 'workspace')]),
      clientFactory: () => Promise.reject(new Error('offline')),
    });
    const current = key('chat-1', '/workspace');
    const state = await provider.startForChat(current);
    expect(state.servers).toEqual([
      { id: 'web', state: 'unavailable', reason: 'source_disconnected' },
    ]);
    const candidates = provider.snapshotCandidates(current);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: { serverId: 'web' } });
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('marks Workspace executors on initial attempt bindings', async () => {
    const { runtime } = operatorRuntime();
    const { provider } = workspaceProvider(runtime, () => [
      config('web', 'workspace'),
    ]);
    const current = key('chat-1', '/workspace');
    await provider.startForChat(current);
    const declaration: ModelToolDeclaration = {
      id: 'mcp__web__search',
      description: 'Search workspace.example.test/mcp.',
      inputSchema: emptySchema,
    };
    const [bound] = await resolveBoundExecutableTools(
      [declaration],
      new Map(),
      provider.resolverFor(current, undefined),
    );
    expect(bound?.server).toBe('web');
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('keeps composed Workspace source when readiness changes before binding', async () => {
    const { runtime } = operatorRuntime('web');
    await runtime.start();
    const { provider } = workspaceProvider(runtime, () => [
      config('web', 'workspace'),
    ]);
    const current = key('chat-1', '/workspace');
    await provider.startForChat(current);
    const id = 'mcp__web__search';
    const workspaceSource = new Map([
      [id, { type: 'mcp' as const, serverId: 'web', workspace: true as const }],
    ]);
    const workspaceResolver = constrainDynamicToolResolver(
      provider.resolverFor(current, runtime),
      workspaceSource,
    );
    await provider.stopForChat(current.chatId);
    expect(workspaceResolver?.resolveDynamicTool(id).state).toBe('unavailable');

    await provider.startForChat(current);
    const operatorSource = new Map([
      [id, { type: 'mcp' as const, serverId: 'web' }],
    ]);
    const operatorResolver = constrainDynamicToolResolver(
      provider.resolverFor(current, runtime),
      operatorSource,
    );
    expect(operatorResolver?.resolveDynamicTool(id).state).toBe('unavailable');
    await provider.onModuleDestroy();
    await runtime.stop();
  });
  it('reports changed retained Workspace declarations as next-Run additions', async () => {
    const { runtime } = operatorRuntime();
    const { provider } = workspaceProvider(runtime, () => [
      config('web', 'workspace'),
    ]);
    const current = key('chat-1', '/workspace');
    await provider.startForChat(current);
    const id = 'mcp__web__search';
    const state = await provider.addToAttempt(
      current,
      additions({
        declaration: {
          id,
          description: 'Old Workspace declaration.',
          inputSchema: emptySchema,
        },
        executor: operatorTool(id),
        server: 'web',
      }),
    );
    expect(state.servers).toEqual([
      {
        id: 'web',
        state: 'available',
        reason: 'available from the next Run',
      },
    ]);
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('closes a client whose start races with Chat stop', async () => {
    const { runtime } = operatorRuntime();
    const pending = deferred<FakeClient>();
    let factoryCalls = 0;
    const provider = new WorkspaceMcpClients(runtime, {
      readConfig: () => Promise.resolve([config('web', 'workspace')]),
      clientFactory: () => {
        factoryCalls += 1;
        return pending.promise;
      },
    });
    const current = key('chat-1', '/workspace');
    const starting = provider.startForChat(current);
    await vi.waitFor(() => expect(factoryCalls).toBe(1));
    const stopping = provider.stopForChat(current.chatId);
    const created = client('web', 'workspace');
    pending.resolve(created);
    await Promise.all([starting, stopping]);
    expect(created.close).toHaveBeenCalledOnce();
    expect(provider.stateForKey(current)).toBeUndefined();
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('ends a transferred hold on the current Workspace key', async () => {
    let now = 1e3;
    const { runtime } = operatorRuntime();
    const { provider, clients } = workspaceProvider(
      runtime,
      () => [config('web', 'workspace')],
      () => now,
    );
    const oldKey = key('chat-1', '/old', 1);
    const newKey = key('chat-1', '/new', 2);
    await provider.startForChat(oldKey);
    provider.beginAttempt(oldKey);
    await provider.startForChat(newKey);
    provider.transferAttempt('chat-1', newKey);
    provider.transferAttempt('chat-1', newKey);
    now += 30 * 60 * 1e3;
    provider.cleanupIdle();
    await Promise.resolve();
    expect(clients[1]?.close).not.toHaveBeenCalled();
    provider.endAttempt('chat-1');
    provider.endAttempt('chat-1');
    now += 30 * 60 * 1e3;
    provider.cleanupIdle();
    await Promise.resolve();
    expect(clients[1]?.close).toHaveBeenCalledOnce();
    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('keeps active Run clients through idle cleanup, then stops them', async () => {
    let now = 1e3;
    const { runtime } = operatorRuntime();
    const { provider, clients } = workspaceProvider(
      runtime,
      () => [config('web', 'workspace')],
      () => now,
    );
    const current = key('chat-1', '/workspace');
    await provider.startForChat(current);
    provider.beginAttempt(current);
    now += 30 * 60 * 1e3;
    provider.cleanupIdle();
    await Promise.resolve();
    expect(clients[0].close).not.toHaveBeenCalled();
    expect(provider.stateForKey(current)).toBeDefined();

    provider.endAttempt(current.chatId);
    now += 30 * 60 * 1e3;
    provider.cleanupIdle();
    await Promise.resolve();
    expect(clients[0].close).toHaveBeenCalledOnce();
    expect(provider.stateForKey(current)).toBeUndefined();
    await provider.onModuleDestroy();
    await runtime.stop();
  });
});

/**
 * A Machine Workspace whose server is a scripted in-process MCP server: the
 * peer answers `mcp.servers` and holds `mcp.open`, and every JSON-RPC request
 * the hub relays is answered here, exactly as the daemon would relay a real
 * server on the box.
 */
const MACHINE_HOSTS = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};
const MACHINE_ROOT = 'machine://devl/srv/work';
const START_SECRET = 'repo-token-sentinel';
const LEARNED_SECRET = 'session-id-sentinel';
const REDACTED = '[REDACTED]';

type JsonRpcCall = Readonly<{
  id: JsonValue;
  method: string;
  params?: JsonValue;
}>;

type FakeMachine = {
  readonly peer: ReturnType<typeof createProtocolPeer>;
  readonly connector: MachineConnector;
  /** Tool names the hub asked this server to call, in order. */
  readonly toolCalls: Array<string>;
  /** Revisions the hub told the Machine the handshake negotiated. */
  readonly protocolVersions: Array<string>;
  setDown(down: boolean): void;
  holdToolCalls(): void;
};

const FAKE_TOOLS: ReadonlyArray<JsonValue> = [
  {
    name: 'deploy',
    description: `Deploy the app with ${START_SECRET}.`,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // A declaration the hub must refuse rather than pass on: its id would
    // carry a Machine-resolved secret into the model's tool list.
    name: `expose-${START_SECRET}`,
    description: 'Leaky name.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function fakeMachine(servers: ReadonlyArray<McpServerEntry>): FakeMachine {
  const toolCalls: Array<string> = [];
  const protocolVersions: Array<string> = [];
  const state = { down: false, holdCalls: false };
  let latest: PeerSession | undefined;
  const peer = createProtocolPeer({
    roots: ['/srv/work'],
    openFailure: () =>
      state.down
        ? 'ssh: connect to host box port 22: Connection refused'
        : undefined,
    answers: {
      'mcp.servers': { value: { servers: [...servers] } },
      'mcp.open': { hold: true },
    },
    onNotification: (method, notification) => {
      if (method !== 'mcp.open' || latest === undefined) return;
      if (notification.method === 'mcp.setProtocolVersion') {
        const version = field(notification.params, 'version');
        if (isString(version)) protocolVersions.push(version);
        return;
      }
      if (notification.method !== 'mcp.message') return;
      const call = jsonRpcCall(field(notification.params, 'message'));
      if (call === undefined) return;
      const answer = answerFor(call, toolCalls, state);
      if (answer === undefined) return;
      latest.notify('mcp.open', 'mcp.message', { message: answer });
    },
  });
  const connector = new MachineConnector({
    machines: MACHINE_HOSTS,
    hubVersion: '9.9.9',
    transportFactory: {
      open: (options) => {
        const transport = peer.factory.open(options);
        latest = peer.sessions.at(-1);
        return transport;
      },
    },
    handshakeTimeoutMs: 2000,
  });
  return {
    peer,
    connector,
    toolCalls,
    protocolVersions,
    setDown: (down) => {
      state.down = down;
    },
    holdToolCalls: () => {
      state.holdCalls = true;
    },
  };
}

function field(
  params: JsonValue | undefined,
  key: string,
): JsonValue | undefined {
  if (!isRecord(params)) return undefined;
  const value = params[key];
  return value === null ||
    isRecord(value) ||
    Array.isArray(value) ||
    isString(value) ||
    isNumber(value) ||
    isBoolean(value)
    ? value
    : undefined;
}

function jsonRpcCall(message: JsonValue | undefined): JsonRpcCall | undefined {
  if (!isRecord(message)) return undefined;
  const id = message['id'];
  const method = message['method'];
  if (!isString(method) || (!isString(id) && !isNumber(id))) return undefined;
  const params = field(message, 'params');
  return params === undefined ? { id, method } : { id, method, params };
}

function answerFor(
  call: JsonRpcCall,
  toolCalls: Array<string>,
  state: { holdCalls: boolean },
): JsonValue | undefined {
  switch (call.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '0.0.1' },
        },
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: { tools: [...FAKE_TOOLS] },
      };
    case 'tools/call':
      return callAnswer(call, toolCalls, state);
    default:
      return undefined;
  }
}

function callAnswer(
  call: JsonRpcCall,
  toolCalls: Array<string>,
  state: { holdCalls: boolean },
): JsonValue | undefined {
  const name = field(call.params, 'name');
  if (!isString(name)) return undefined;
  toolCalls.push(name);
  // A held call is one the Machine never answers: it dies with the channel.
  if (state.holdCalls) return undefined;
  return {
    jsonrpc: '2.0',
    id: call.id,
    result: {
      content: [
        {
          type: 'text',
          text: `deployed with ${START_SECRET} and ${LEARNED_SECRET}`,
        },
      ],
    },
  };
}

function configurationRequests(peer: FakeMachine['peer']): number {
  return peer.sessions
    .flatMap((session) => [...session.requests])
    .filter((method) => method === 'mcp.servers').length;
}

/** Starts one Machine Workspace, answering its `mcp.open` from the test. */
async function startMachineWorkspace(
  provider: WorkspaceMcpClients,
  machine: FakeMachine,
  workspace: WorkspaceMcpKey,
  sessionIndex = 0,
): Promise<WorkspaceMcpEntryState> {
  const started = provider.startForChat(workspace);
  const session = await machine.peer.session(sessionIndex);
  await session.awaitRequests(2);
  session.release('mcp.open', { protectedValues: [START_SECRET] }, true);
  return started;
}

function availableTool(
  provider: WorkspaceMcpClients,
  workspace: WorkspaceMcpKey,
  id: string,
): Tool {
  const candidate = provider
    .snapshotCandidates(workspace)
    .find((entry) => entry.state === 'available' && entry.tool.id === id);
  if (candidate?.state !== 'available')
    throw new Error(`Expected ${id} to be offered.`);
  return candidate.tool;
}

describe('WorkspaceMcpClients over a Machine', () => {
  it('runs a Machine Workspace’s servers from the Machine', async () => {
    const machine = fakeMachine([
      { name: 'storybook', transport: 'http', state: 'available' },
      {
        name: 'broken',
        state: 'unavailable',
        diagnostic: 'unset variable REPO_TOKEN',
      },
    ]);
    const { runtime } = operatorRuntime();
    const readConfig = vi.fn(() => Promise.reject(new Error('unreachable')));
    const provider = new WorkspaceMcpClients(runtime, {
      connector: machine.connector,
      readConfig,
    });
    const workspace = key('chat-1', MACHINE_ROOT);

    const state = await startMachineWorkspace(provider, machine, workspace);

    // The Machine read and resolved the Workspace's configuration, here.
    expect(readConfig).not.toHaveBeenCalled();
    expect(state.servers).toEqual([
      { id: 'storybook', state: 'available' },
      {
        id: 'broken',
        state: 'unavailable',
        reason: 'unset variable REPO_TOKEN',
      },
    ]);
    const offered = provider
      .snapshotCandidates(workspace)
      .filter((candidate) => candidate.source.type === 'mcp');
    expect(offered.map((candidate) => candidate.source)).toEqual([
      { type: 'mcp', serverId: 'storybook', workspace: true },
    ]);
    const deploy = offered[0];
    if (deploy?.state !== 'available')
      throw new Error('Expected the deploy tool to be offered.');
    // Advertised exactly as a local Workspace server's declaration, with every
    // value the Machine resolved redacted out of it.
    expect(deploy.tool.id).toBe('mcp__storybook__deploy');
    expect(deploy.tool.description).toContain(REDACTED);
    expect(deploy.tool.description).not.toContain(START_SECRET);

    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('redacts the values the Machine resolved from results and diagnostics', async () => {
    const machine = fakeMachine([
      { name: 'storybook', transport: 'stdio', state: 'available' },
    ]);
    const { runtime } = operatorRuntime();
    const provider = new WorkspaceMcpClients(runtime, {
      connector: machine.connector,
    });
    const workspace = key('chat-1', MACHINE_ROOT);
    await startMachineWorkspace(provider, machine, workspace);
    const session = await machine.peer.session(0);
    const warn = vi.spyOn(Logger.prototype, 'warn');

    // A value learned after the start is a secret from the moment it arrives.
    session.notify('mcp.open', 'mcp.protected', { values: [LEARNED_SECRET] });
    session.notify('mcp.open', 'mcp.stderr', {
      text: `connected as ${LEARNED_SECRET} with ${START_SECRET}\n`,
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    const diagnostics = warn.mock.calls
      .map(([text]) => String(text))
      .join('\n');
    expect(diagnostics).toContain(REDACTED);
    expect(diagnostics).not.toContain(START_SECRET);
    expect(diagnostics).not.toContain(LEARNED_SECRET);

    const result = await availableTool(
      provider,
      workspace,
      'mcp__storybook__deploy',
    ).execute(toolContext, {});
    const observed = JSON.stringify(result);
    expect(observed).toContain(REDACTED);
    expect(observed).not.toContain(START_SECRET);
    expect(observed).not.toContain(LEARNED_SECRET);

    await provider.onModuleDestroy();
    await runtime.stop();
  });

  it('fails calls in the Run and re-discovers on the next start', async () => {
    const machine = fakeMachine([
      { name: 'storybook', transport: 'http', state: 'available' },
    ]);
    const { runtime } = operatorRuntime();
    const provider = new WorkspaceMcpClients(runtime, {
      connector: machine.connector,
    });
    const workspace = key('chat-1', MACHINE_ROOT);
    await startMachineWorkspace(provider, machine, workspace);
    const tool = availableTool(provider, workspace, 'mcp__storybook__deploy');

    machine.holdToolCalls();
    machine.setDown(true);
    const inFlight = tool.execute(toolContext, {});
    await vi.waitFor(() => expect(machine.toolCalls).toEqual(['deploy']));
    const session = await machine.peer.session(0);
    session.drop();

    await expect(inFlight).resolves.toMatchObject({
      status: 'error',
      type: 'machine_unavailable',
    });
    // A crashed server: the tool is gone until the Machine is reachable again.
    expect(
      provider
        .snapshotCandidates(workspace)
        .some((candidate) => candidate.source.type === 'mcp'),
    ).toBe(false);

    await provider.stopForChat(workspace.chatId);
    machine.setDown(false);
    const restarted = await startMachineWorkspace(
      provider,
      machine,
      workspace,
      1,
    );

    expect(restarted.servers).toEqual([
      { id: 'storybook', state: 'available' },
    ]);
    expect(configurationRequests(machine.peer)).toBe(2);

    await provider.onModuleDestroy();
    await runtime.stop();
  });
});
