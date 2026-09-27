import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type ModelToolDeclaration } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { resolveBoundExecutableTools } from '../runs/snapshot-tool-execution';
import { type McpDiscoveryResult } from './mcp-server-client';
import {
  McpRuntimeService,
  type McpRuntimeClient,
} from './mcp-runtime.service';
import {
  WorkspaceMcpClients,
  type WorkspaceMcpKey,
} from './workspace-mcp-clients';
import { type WorkspaceMcpServerConfig } from './workspace-mcp-config';
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

    provider.endAttempt(current);
    now += 30 * 60 * 1e3;
    provider.cleanupIdle();
    await Promise.resolve();
    expect(clients[0].close).toHaveBeenCalledOnce();
    expect(provider.stateForKey(current)).toBeUndefined();
    await provider.onModuleDestroy();
    await runtime.stop();
  });
});
