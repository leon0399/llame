import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  McpRuntimeService,
  STDIO_MAX_FAST_ATTEMPTS,
  type McpRuntimeClient,
  type McpRuntimeClientFactory,
  type McpRuntimeServerDefinition,
} from './mcp-runtime.service';
import {
  McpProtocolUnsupportedError,
  type McpDiscoveredTool,
  type McpDiscoveryResult,
} from './mcp-server-client';
import { hashToolDeclaration } from '../tools/turn-tool-catalog';
import { type TenantRunner } from '../db/tenant-db.service';

const MINUTE_MS = 60_000;

/** Executor contexts below never reach `.runAs` — every case resolves before executing. */
const fakeTenantDb: TenantRunner = {
  runAs: () => {
    throw new Error('runAs should not be called by these executor contexts');
  },
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const emptyDiscovery = (): McpDiscoveryResult => ({ tools: [], refused: [] });

function discoveredTool(
  serverId: string,
  remoteName: string,
): McpDiscoveredTool {
  return {
    definition: {
      id: `mcp__${serverId}__${remoteName}`,
      remoteName,
      description: `Use ${remoteName}.`,
      inputSchema: { type: 'object', properties: {} },
    },
    execute: vi.fn(() =>
      Promise.resolve({
        disposition: 'none' as const,
        result: { status: 'success' as const, output: remoteName },
      }),
    ),
  };
}

function discovery(...tools: Array<McpDiscoveredTool>): McpDiscoveryResult {
  return { tools, refused: [] };
}

function fakeClient(
  discover: McpRuntimeClient['discover'] = vi.fn(() =>
    Promise.resolve(emptyDiscovery()),
  ),
): McpRuntimeClient & {
  readonly discover: ReturnType<typeof vi.fn<McpRuntimeClient['discover']>>;
  readonly close: ReturnType<typeof vi.fn<McpRuntimeClient['close']>>;
} {
  return {
    discover: vi.fn(discover),
    close: vi.fn(() => Promise.resolve()),
  };
}

const servers = (
  ...ids: Array<string>
): Readonly<Record<string, McpRuntimeServerDefinition>> =>
  Object.fromEntries(
    ids.map((id) => [id, { url: `https://${id}.example.test/mcp` }]),
  );

const stdioServers = (
  ...ids: Array<string>
): Readonly<Record<string, McpRuntimeServerDefinition>> =>
  Object.fromEntries(
    ids.map((id) => [id, { transport: 'stdio' as const, command: 'node' }]),
  );

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('McpRuntimeService', () => {
  it('initializes once even when lifecycle hooks are repeated', async () => {
    const client = fakeClient();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.resolve(client),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory,
      random: () => 0.5,
    });

    runtime.onModuleInit();
    await flushAsync();
    runtime.onModuleInit();
    expect(clientFactory).toHaveBeenCalledOnce();

    await runtime.onModuleDestroy();
    runtime.onModuleInit();
    expect(clientFactory).toHaveBeenCalledOnce();
  });

  it('clamps a non-finite refresh jitter to the earliest refresh', async () => {
    vi.useFakeTimers();
    const client = fakeClient(vi.fn(() => Promise.resolve(emptyDiscovery())));
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => Number.POSITIVE_INFINITY,
    });

    runtime.onModuleInit();
    await flushAsync();
    expect(client.discover).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    await flushAsync();
    expect(client.discover).toHaveBeenCalledTimes(2);

    await runtime.onModuleDestroy();
  });

  it('reconnects when a tool executor reports a reconnect disposition', async () => {
    vi.useFakeTimers();
    const discovered: McpDiscoveredTool = {
      ...discoveredTool('web', 'reconnect'),
      execute: vi.fn(() =>
        Promise.resolve({
          disposition: 'reconnect' as const,
          result: {
            status: 'error' as const,
            type: 'execution_failed',
            message: 'remote session ended',
          },
        }),
      ),
    };
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discovered))),
    );
    const replacement = fakeClient();
    const clientFactory = vi
      .fn<McpRuntimeClientFactory>()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(replacement);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory,
      random: () => 0,
    });

    runtime.onModuleInit();
    await flushAsync();
    const resolution = runtime.resolveDynamicTool('mcp__web__reconnect');
    if (resolution.state !== 'available') {
      throw new Error('expected the dynamic tool to be available');
    }

    await expect(
      resolution.executor.execute(
        {
          userId: 'user-1',
          chatId: 'chat-1',
          tenantDb: fakeTenantDb,
          toolCallId: 'call-1',
        },
        { query: 'evidence' },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'execution_failed',
      message: 'remote session ended',
    });
    expect(client.close).toHaveBeenCalledOnce();
    expect(runtime.resolveDynamicTool('mcp__web__reconnect')).toEqual({
      state: 'unavailable',
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushAsync();
    expect(clientFactory).toHaveBeenCalledTimes(2);

    await runtime.onModuleDestroy();
  });

  it('returns unavailable for a canonical tool removed by refresh', async () => {
    vi.useFakeTimers();
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'lookup')))
        .mockResolvedValueOnce(emptyDiscovery()),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0,
    });

    runtime.onModuleInit();
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__lookup').state).toBe(
      'available',
    );

    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(runtime.resolveDynamicTool('mcp__web__lookup')).toEqual({
      state: 'unavailable',
    });

    await runtime.onModuleDestroy();
  });

  it('projects the complete admitted inventory without permission input or synthetic offline identities', async () => {
    const client = fakeClient(
      vi.fn(() =>
        Promise.resolve(
          discovery(
            discoveredTool('web', 'zebra'),
            discoveredTool('web', 'alpha'),
          ),
        ),
      ),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0.5,
    });

    runtime.onModuleInit();
    await flushAsync();

    const snapshot = runtime.snapshotCandidates();
    expect(
      snapshot.map((candidate) =>
        candidate.state === 'available' ? candidate.tool.id : undefined,
      ),
    ).toEqual(['mcp__web__alpha', 'mcp__web__zebra']);

    const offline = new McpRuntimeService(servers('web'));
    expect(offline.snapshotCandidates()).toEqual([]);

    await runtime.onModuleDestroy();
  });

  it('omits refused identities and retains only the last admitted ids while unavailable', async () => {
    vi.useFakeTimers();
    const first = discoveredTool('web', 'first');
    const second = discoveredTool('web', 'second');
    const replacement = discoveredTool('web', 'replacement');
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce({
          tools: [first, second],
          refused: [
            {
              index: 2,
              id: 'mcp__web__refused',
              reason: 'invalid_schema' as const,
            },
          ],
        })
        .mockResolvedValueOnce(discovery(replacement)),
    );
    let disconnect: (() => void) | undefined;
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn<McpRuntimeClientFactory>((config) => {
        disconnect = config.onDisconnect;
        return Promise.resolve(client);
      }),
      random: () => 0,
    });

    runtime.onModuleInit();
    await flushAsync();
    expect(runtime.snapshotCandidates()).toHaveLength(2);

    disconnect?.();
    expect(runtime.snapshotCandidates()).toEqual([
      expect.objectContaining({
        id: 'mcp__web__first',
        state: 'unavailable',
        reason: 'source_disconnected',
      }),
      expect.objectContaining({
        id: 'mcp__web__second',
        state: 'unavailable',
        reason: 'source_disconnected',
      }),
    ]);
    expect(runtime.snapshotCandidates()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mcp__web__refused' }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(0);
    await flushAsync();
    const replacementCandidates = runtime.snapshotCandidates();
    expect(replacementCandidates).toHaveLength(1);
    if (replacementCandidates[0]?.state !== 'available') {
      throw new Error('expected replacement tool to be available');
    }
    expect(replacementCandidates[0].tool.id).toBe('mcp__web__replacement');

    await runtime.onModuleDestroy();
  });

  it('projects an empty immutable snapshot without starting network work', () => {
    const runtime = new McpRuntimeService(servers('web'));

    const candidates = runtime.snapshotCandidates();

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(runtime.resolveDynamicTool('search_conversations')).toEqual({
      state: 'not_dynamic',
    });
    for (const malformed of [
      'mcp__web__',
      'mcp__web___edge',
      'mcp__web__edge_',
      'mcp__web__Find／Docs',
      `mcp__web__${'x'.repeat(64)}`,
    ]) {
      expect(runtime.resolveDynamicTool(malformed)).toEqual({
        state: 'not_dynamic',
      });
    }
    expect(runtime.snapshotCandidates()).toEqual([]);
  });

  it('starts every server independently without awaiting an offline sibling', async () => {
    vi.useFakeTimers();
    const webConnection = deferred<McpRuntimeClient>();
    const docsClient = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('docs', 'lookup')))),
    );
    const clientFactory = vi.fn<McpRuntimeClientFactory>((config) =>
      config.serverId === 'web'
        ? webConnection.promise
        : Promise.resolve(docsClient),
    );
    const runtime = new McpRuntimeService(servers('web', 'docs'), {
      clientFactory,
      random: () => 0.5,
    });

    expect(runtime.onModuleInit()).toBeUndefined();
    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(runtime.snapshotCandidates()).toEqual([]);

    await flushAsync();

    expect(runtime.resolveDynamicTool('mcp__docs__lookup').state).toBe(
      'available',
    );
    expect(runtime.resolveDynamicTool('mcp__web__search')).toEqual({
      state: 'unavailable',
    });
    webConnection.reject(new Error('offline'));
    await flushAsync();
    const docsCandidates = runtime.snapshotCandidates();
    expect(docsCandidates).toHaveLength(1);
    if (docsCandidates[0]?.state !== 'available') {
      throw new Error('expected docs tool to remain available');
    }
    expect(docsCandidates[0].tool.id).toBe('mcp__docs__lookup');

    await runtime.onModuleDestroy();
  });

  it('samples the 48-72 minute refresh independently per server and never refreshes from a turn read', async () => {
    vi.useFakeTimers();
    const webClient = fakeClient();
    const docsClient = fakeClient();
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(0.5);
    const runtime = new McpRuntimeService(servers('web', 'docs'), {
      random,
      clientFactory: vi.fn(({ serverId }) =>
        Promise.resolve(serverId === 'web' ? webClient : docsClient),
      ),
    });
    runtime.onModuleInit();
    await flushAsync();
    expect(webClient.discover).toHaveBeenCalledTimes(1);
    expect(docsClient.discover).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 20; index += 1) {
      runtime.snapshotCandidates();
    }
    expect(webClient.discover).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(webClient.discover).toHaveBeenCalledTimes(2);
    expect(docsClient.discover).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * MINUTE_MS);
    expect(docsClient.discover).toHaveBeenCalledTimes(2);

    await runtime.onModuleDestroy();
  });

  it('keeps the last complete immutable catalog during one single-flight refresh and publishes the replacement atomically', async () => {
    vi.useFakeTimers();
    const refresh = deferred<McpDiscoveryResult>();
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'old')))
        .mockImplementationOnce(() => refresh.promise),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();

    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(client.discover).toHaveBeenCalledTimes(2);
    const duringRefresh = runtime.snapshotCandidates();
    expect(duringRefresh).toHaveLength(1);
    if (duringRefresh[0]?.state !== 'available') {
      throw new Error('expected old tool to remain available during refresh');
    }
    expect(duringRefresh[0].tool.id).toBe('mcp__web__old');

    await vi.advanceTimersByTimeAsync(72 * MINUTE_MS);
    expect(client.discover).toHaveBeenCalledTimes(2);

    refresh.resolve(discovery(discoveredTool('web', 'new')));
    await flushAsync();
    const candidates = runtime.snapshotCandidates();
    expect(candidates[0]?.state).toBe('available');
    if (candidates[0]?.state !== 'available') {
      throw new Error('expected the replacement tool to be available');
    }
    expect(candidates[0].tool.id).toBe('mcp__web__new');
    expect(candidates).toHaveLength(1);
    expect(Object.isFrozen(candidates)).toBe(true);

    await runtime.onModuleDestroy();
  });

  it('withdraws the complete old catalog on refresh failure before reconnecting', async () => {
    vi.useFakeTimers();
    const refresh = deferred<McpDiscoveryResult>();
    const first = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'old')))
        .mockImplementationOnce(() => refresh.promise),
    );
    const second = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'new')))),
    );
    const factory = vi
      .fn<McpRuntimeClientFactory>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValue(0);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random,
    });
    runtime.onModuleInit();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);

    refresh.reject(new Error('refresh failed'));
    await flushAsync();
    expect(runtime.snapshotCandidates()).toEqual([
      expect.objectContaining({
        state: 'unavailable',
        reason: 'discovery_failed',
      }),
    ]);
    expect(first.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(runtime.resolveDynamicTool('mcp__web__new').state).toBe('available');

    await runtime.onModuleDestroy();
  });

  it('keeps protocol-unsupported and discovery-failed reasons closed and isolated per server', async () => {
    vi.useFakeTimers();
    const docs = fakeClient(
      vi.fn(() => Promise.reject(new Error('bad catalog'))),
    );
    const runtime = new McpRuntimeService(servers('web', 'docs'), {
      clientFactory: vi.fn(({ serverId }) => {
        if (serverId === 'web') {
          return Promise.reject(new McpProtocolUnsupportedError());
        }
        return Promise.resolve(docs);
      }),
      random: () => 1,
    });
    runtime.onModuleInit();
    await flushAsync();

    expect(runtime.snapshotCandidates()).toEqual([]);

    await runtime.onModuleDestroy();
  });

  it('publishes valid admitted siblings when discovery reports an isolated refusal', async () => {
    vi.useFakeTimers();
    const admitted = discoveredTool('web', 'valid');
    const client = fakeClient(
      vi.fn(() =>
        Promise.resolve({
          tools: [admitted],
          refused: [
            {
              index: 1,
              id: 'mcp__web__collision',
              reason: 'name_collision' as const,
            },
            {
              index: 2,
              id: 'mcp__web__refused',
              reason: 'invalid_schema' as const,
            },
            { index: 3, reason: 'invalid_schema' as const },
          ],
        }),
      ),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0.5,
    });
    runtime.onModuleInit();
    await flushAsync();

    const resolution = runtime.resolveDynamicTool('mcp__web__valid');
    expect(resolution.state).toBe('available');
    if (resolution.state !== 'available') {
      throw new Error('expected an available dynamic tool');
    }
    expect(resolution.declarationHash).toBe(
      hashToolDeclaration({
        id: admitted.definition.id,
        description: admitted.definition.description,
        inputSchema: admitted.definition.inputSchema,
      }),
    );
    expect(resolution.executor.id).toBe('mcp__web__valid');
    expect(resolution.executor.classification).toBe('read_only');
    const abortController = new AbortController();
    await expect(
      resolution.executor.execute(
        {
          userId: 'user-1',
          chatId: 'chat-1',
          tenantDb: fakeTenantDb,
          toolCallId: 'call-1',
          abortSignal: abortController.signal,
        },
        { query: 'evidence' },
      ),
    ).resolves.toMatchObject({ status: 'success' });
    expect(admitted.execute).toHaveBeenCalledTimes(1);
    expect(admitted.execute).toHaveBeenCalledWith(
      { query: 'evidence' },
      expect.objectContaining({
        toolCallId: 'call-1',
        abortSignal: abortController.signal,
      }),
    );
    const candidates = runtime.snapshotCandidates();
    expect(candidates).toHaveLength(1);
    if (candidates[0]?.state !== 'available') {
      throw new Error('expected valid tool to be available');
    }
    expect(candidates[0].tool.id).toBe('mcp__web__valid');
    expect(runtime.snapshotCandidates()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mcp__web__refused' }),
        expect.objectContaining({ id: 'mcp__web__collision' }),
        expect.objectContaining({ id: 'mcp__web__unknown' }),
      ]),
    );

    await runtime.onModuleDestroy();
  });

  it('does not retain refused identities across refresh or withdrawal', async () => {
    vi.useFakeTimers();
    const refresh = deferred<McpDiscoveryResult>();
    let disconnect: (() => void) | undefined;
    const refusedId = 'mcp__web__search';
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce({
          tools: [],
          refused: [
            { index: 0, id: refusedId, reason: 'invalid_schema' as const },
          ],
        })
        .mockImplementationOnce(() => refresh.promise),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn<McpRuntimeClientFactory>((config) => {
        disconnect = config.onDisconnect;
        return Promise.resolve(client);
      }),
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();

    expect(runtime.snapshotCandidates()).toEqual([]);
    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(runtime.snapshotCandidates()).toEqual([]);

    refresh.resolve({
      tools: [],
      refused: [{ index: 0, id: refusedId, reason: 'name_collision' as const }],
    });
    await flushAsync();
    expect(runtime.snapshotCandidates()).toEqual([]);

    disconnect?.();
    expect(runtime.snapshotCandidates()).toEqual([]);

    await runtime.onModuleDestroy();
  });

  it('withdraws synchronously on disconnect and reconnects with a fresh client after AWS Full Jitter', async () => {
    vi.useFakeTimers();
    const clients = [
      fakeClient(
        vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'first')))),
      ),
      fakeClient(
        vi.fn(() =>
          Promise.resolve(discovery(discoveredTool('web', 'second'))),
        ),
      ),
    ];
    const disconnects: Array<() => void> = [];
    let connectionIndex = 0;
    const createClient: McpRuntimeClientFactory = (config) => {
      if (config.onDisconnect !== undefined) {
        disconnects.push(config.onDisconnect);
      }
      const client = clients[connectionIndex];
      connectionIndex += 1;
      return client === undefined
        ? Promise.reject(new Error('unexpected connection'))
        : Promise.resolve(client);
    };
    const clientFactory = vi.fn(createClient);
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0.25) // first periodic refresh
      .mockReturnValueOnce(0.5) // attempt 0: 500 ms
      .mockReturnValue(0.25);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory,
      random,
    });
    runtime.onModuleInit();
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__first').state).toBe(
      'available',
    );

    disconnects[0]?.();
    expect(runtime.resolveDynamicTool('mcp__web__first')).toEqual({
      state: 'unavailable',
    });
    expect(runtime.snapshotCandidates()).toEqual([
      expect.objectContaining({
        state: 'unavailable',
        reason: 'source_disconnected',
      }),
    ]);
    expect(clients[0]?.close).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(clientFactory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(clientFactory).toHaveBeenCalledTimes(2);
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__first')).toEqual({
      state: 'unavailable',
    });
    expect(runtime.resolveDynamicTool('mcp__web__second').state).toBe(
      'available',
    );

    await runtime.onModuleDestroy();
  });

  it('fails a previously resolved executor closed after its client disconnects', async () => {
    vi.useFakeTimers();
    const discovered = discoveredTool('web', 'search');
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discovered))),
    );
    let disconnect: (() => void) | undefined;
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn<McpRuntimeClientFactory>((config) => {
        disconnect = config.onDisconnect;
        return Promise.resolve(client);
      }),
      random: () => 1,
    });
    runtime.onModuleInit();
    await flushAsync();

    const resolution = runtime.resolveDynamicTool('mcp__web__search');
    expect(resolution.state).toBe('available');
    if (resolution.state !== 'available') {
      throw new Error('expected an available dynamic tool');
    }

    disconnect?.();
    await expect(
      resolution.executor.execute(
        {
          userId: 'user-1',
          chatId: 'chat-1',
          tenantDb: fakeTenantDb,
          toolCallId: 'call-1',
        },
        { query: 'evidence' },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'not_available',
      message: 'Tool "mcp__web__search" is not available.',
    });
    expect(discovered.execute).not.toHaveBeenCalled();

    await runtime.onModuleDestroy();
  });

  it.each(['declaration drift', 'removal'] as const)(
    'fails a previously resolved executor closed after a successful refresh with %s',
    async (change) => {
      vi.useFakeTimers();
      const original = discoveredTool('web', 'search');
      const unchangedReplacement = discoveredTool('web', 'search');
      const replacement: McpDiscoveredTool = {
        ...unchangedReplacement,
        definition: {
          ...unchangedReplacement.definition,
          description: 'Changed declaration.',
        },
      };
      const client = fakeClient(
        vi
          .fn<McpRuntimeClient['discover']>()
          .mockResolvedValueOnce(discovery(original))
          .mockResolvedValueOnce(
            change === 'declaration drift'
              ? discovery(replacement)
              : emptyDiscovery(),
          ),
      );
      const runtime = new McpRuntimeService(servers('web'), {
        clientFactory: vi.fn(() => Promise.resolve(client)),
        random: () => 0,
      });
      runtime.onModuleInit();
      await flushAsync();

      const resolution = runtime.resolveDynamicTool('mcp__web__search');
      expect(resolution.state).toBe('available');
      if (resolution.state !== 'available') {
        throw new Error('expected an available dynamic tool');
      }

      await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
      const candidates = runtime.snapshotCandidates();
      expect(
        candidates.map((candidate) =>
          candidate.state === 'available' ? candidate.tool.id : candidate.id,
        ),
      ).toEqual(change === 'removal' ? [] : ['mcp__web__search']);
      await expect(
        resolution.executor.execute(
          {
            userId: 'user-1',
            chatId: 'chat-1',
            tenantDb: fakeTenantDb,
            toolCallId: 'call-1',
          },
          { query: 'evidence' },
        ),
      ).resolves.toEqual({
        status: 'error',
        type: 'not_available',
        message: 'Tool "mcp__web__search" is not available.',
      });
      expect(original.execute).not.toHaveBeenCalled();

      await runtime.onModuleDestroy();
    },
  );

  it('keeps a resolved executor callable across a same-client refresh with an unchanged declaration', async () => {
    vi.useFakeTimers();
    const original = discoveredTool('web', 'search');
    const replacement = discoveredTool('web', 'search');
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(original))
        .mockResolvedValueOnce(discovery(replacement)),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();

    const resolution = runtime.resolveDynamicTool('mcp__web__search');
    expect(resolution.state).toBe('available');
    if (resolution.state !== 'available') {
      throw new Error('expected an available dynamic tool');
    }

    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    await expect(
      resolution.executor.execute(
        {
          userId: 'user-1',
          chatId: 'chat-1',
          tenantDb: fakeTenantDb,
          toolCallId: 'call-1',
        },
        { query: 'evidence' },
      ),
    ).resolves.toMatchObject({ status: 'success' });
    expect(original.execute).toHaveBeenCalledTimes(1);
    expect(replacement.execute).not.toHaveBeenCalled();

    await runtime.onModuleDestroy();
  });

  it('treats a disconnect raised before the client factory resolves as pending and never publishes that client', async () => {
    vi.useFakeTimers();
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'unsafe')))),
    );
    const createClient: McpRuntimeClientFactory = (config) => {
      config.onDisconnect?.();
      return Promise.resolve(client);
    };
    const factory = vi.fn(createClient);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random: () => 1,
    });
    runtime.onModuleInit();
    await flushAsync();

    expect(client.discover).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(runtime.snapshotCandidates()).toEqual([]);
    expect(factory).toHaveBeenCalledTimes(1);

    await runtime.onModuleDestroy();
  });

  it('ignores a stale timer callback by exact handle without losing the current reconnect timer', async () => {
    const createRealTimerHandle: typeof setTimeout = setTimeout;
    const scheduled: Array<{
      readonly callback: () => void;
      readonly handle: ReturnType<typeof setTimeout>;
    }> = [];
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback) => {
        const handle = createRealTimerHandle(() => undefined, 0);
        scheduled.push({ callback: () => callback(), handle });
        return handle;
      });
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'ready')))),
    );
    let disconnect: (() => void) | undefined;
    const createClient: McpRuntimeClientFactory = (config) => {
      disconnect = config.onDisconnect;
      return Promise.resolve(client);
    };
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(createClient),
      random: () => 0.5,
    });
    runtime.onModuleInit();
    await flushAsync();
    const staleRefreshTimer = scheduled[0];
    expect(staleRefreshTimer).toBeDefined();

    disconnect?.();
    const reconnectTimer = scheduled[1];
    expect(reconnectTimer).toBeDefined();
    clearTimeoutSpy.mockClear();
    staleRefreshTimer?.callback();

    await runtime.onModuleDestroy();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(reconnectTimer?.handle);
    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('increments Full Jitter after complete-discovery failures and resets only after a complete success', async () => {
    vi.useFakeTimers();
    const clients = [
      fakeClient(vi.fn(() => Promise.reject(new Error('bad page')))),
      fakeClient(vi.fn(() => Promise.reject(new Error('still bad')))),
      fakeClient(
        vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'ready')))),
      ),
      fakeClient(
        vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'fresh')))),
      ),
    ];
    const disconnects: Array<() => void> = [];
    let connectionIndex = 0;
    const createClient: McpRuntimeClientFactory = (config) => {
      if (config.onDisconnect !== undefined) {
        disconnects.push(config.onDisconnect);
      }
      const client = clients[connectionIndex];
      connectionIndex += 1;
      return client === undefined
        ? Promise.reject(new Error('unexpected connection'))
        : Promise.resolve(client);
    };
    const factory = vi.fn(createClient);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random: () => 0.5,
    });
    runtime.onModuleInit();
    await flushAsync();

    await vi.advanceTimersByTimeAsync(499);
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(factory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(3);
    expect(runtime.resolveDynamicTool('mcp__web__ready').state).toBe(
      'available',
    );

    disconnects[2]?.();
    await vi.advanceTimersByTimeAsync(499);
    expect(factory).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(4);
    expect(runtime.resolveDynamicTool('mcp__web__fresh').state).toBe(
      'available',
    );

    await runtime.onModuleDestroy();
  });

  it('fences late refresh and disconnect callbacks by generation and exact client identity', async () => {
    vi.useFakeTimers();
    const staleRefresh = deferred<McpDiscoveryResult>();
    const staleClose = deferred<void>();
    const first = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'old')))
        .mockImplementationOnce(() => staleRefresh.promise),
    );
    first.close.mockImplementation(() => staleClose.promise);
    const second = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'current')))),
    );
    const disconnects: Array<() => void> = [];
    let connectionIndex = 0;
    const createClient: McpRuntimeClientFactory = (config) => {
      if (config.onDisconnect !== undefined) {
        disconnects.push(config.onDisconnect);
      }
      const client = connectionIndex === 0 ? first : second;
      connectionIndex += 1;
      return Promise.resolve(client);
    };
    const factory = vi.fn(createClient);
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0) // first refresh at 48 minutes
      .mockReturnValueOnce(0) // reconnect immediately
      .mockReturnValue(0.5);
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random,
    });
    runtime.onModuleInit();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(first.discover).toHaveBeenCalledTimes(2);

    disconnects[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__current').state).toBe(
      'available',
    );

    staleRefresh.resolve(discovery(discoveredTool('web', 'stale')));
    staleClose.resolve();
    disconnects[0]?.();
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__current').state).toBe(
      'available',
    );
    expect(runtime.resolveDynamicTool('mcp__web__stale')).toEqual({
      state: 'unavailable',
    });
    expect(second.close).not.toHaveBeenCalled();

    await runtime.onModuleDestroy();
  });

  it('cancels timers, withdraws catalogs, and closes idempotently within one aggregate shutdown bound', async () => {
    vi.useFakeTimers();
    const neverClosed = deferred<void>();
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'lookup')))),
    );
    client.close.mockImplementation(() => neverClosed.promise);
    const factory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.resolve(client),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();

    const first = runtime.onModuleDestroy();
    const second = runtime.onModuleDestroy();
    expect(first).toBe(second);
    expect(runtime.resolveDynamicTool('mcp__web__lookup')).toEqual({
      state: 'unavailable',
    });
    expect(client.close).toHaveBeenCalledTimes(1);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE_MS);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight refresh and includes it in the aggregate shutdown bound', async () => {
    vi.useFakeTimers();
    const refresh = deferred<McpDiscoveryResult>();
    let refreshSignal: AbortSignal | undefined;
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'lookup')))
        .mockImplementationOnce((options) => {
          refreshSignal = options?.signal;
          return refresh.promise;
        }),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: vi.fn(() => Promise.resolve(client)),
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);

    const shutdown = runtime.onModuleDestroy();
    expect(refreshSignal?.aborted).toBe(true);
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(shutdown).resolves.toBeUndefined();

    refresh.resolve(emptyDiscovery());
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__lookup')).toEqual({
      state: 'unavailable',
    });
  });

  it('does not re-close a formerly current client when disconnect arrives after shutdown starts', async () => {
    vi.useFakeTimers();
    const refresh = deferred<McpDiscoveryResult>();
    let disconnect: (() => void) | undefined;
    const client = fakeClient(
      vi
        .fn<McpRuntimeClient['discover']>()
        .mockResolvedValueOnce(discovery(discoveredTool('web', 'lookup')))
        .mockImplementationOnce(() => refresh.promise),
    );
    const neverClosed = deferred<void>();
    client.close.mockImplementation(() => neverClosed.promise);
    const factory = vi.fn<McpRuntimeClientFactory>((config) => {
      disconnect = config.onDisconnect;
      return Promise.resolve(client);
    });
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random: () => 0,
    });
    runtime.onModuleInit();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(48 * MINUTE_MS);
    expect(client.discover).toHaveBeenCalledTimes(2);

    const shutdown = runtime.onModuleDestroy();
    expect(client.close).toHaveBeenCalledTimes(1);

    refresh.resolve(emptyDiscovery());
    disconnect?.();
    await flushAsync();
    expect(runtime.resolveDynamicTool('mcp__web__lookup')).toEqual({
      state: 'unavailable',
    });
    expect(client.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    await expect(shutdown).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.discover).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending connection and bounds shutdown when its factory ignores cancellation', async () => {
    vi.useFakeTimers();
    const connection = deferred<McpRuntimeClient>();
    const client = fakeClient(
      vi.fn(() => Promise.resolve(discovery(discoveredTool('web', 'late')))),
    );
    let connectSignal: AbortSignal | undefined;
    const factory = vi.fn<McpRuntimeClientFactory>((config) => {
      connectSignal = config.signal;
      return connection.promise;
    });
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory: factory,
      random: () => 0,
    });
    runtime.onModuleInit();

    const shutdown = runtime.onModuleDestroy();
    expect(connectSignal?.aborted).toBe(true);
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await flushAsync();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(shutdown).resolves.toBeUndefined();

    connection.resolve(client);
    await flushAsync();
    expect(client.discover).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(runtime.resolveDynamicTool('mcp__web__late')).toEqual({
      state: 'unavailable',
    });

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});

describe('McpRuntimeService stdio lifecycle', () => {
  // Task 2.2 — the attempt budget is bounded, unlike the remote path.
  it('stops the fast retry after the bounded attempt budget', async () => {
    vi.useFakeTimers();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.reject(new Error('spawn failed')),
    );
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();
    expect(clientFactory).toHaveBeenCalledTimes(1);

    // Drive well past the exponential ceiling: only the bounded number of
    // fast attempts may happen, and the budget must not keep doubling.
    await vi.advanceTimersByTimeAsync(12 * MINUTE_MS);
    await flushAsync();

    expect(clientFactory.mock.calls.length).toBeLessThanOrEqual(
      STDIO_MAX_FAST_ATTEMPTS + 1,
    );

    await runtime.onModuleDestroy();
  });

  // Task 2.2 — a settled server keeps a recovery occasion (design.md D5).
  it('retries a settled stdio server on the periodic occasion', async () => {
    vi.useFakeTimers();
    let failing = true;
    const recovered = fakeClient();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      failing
        ? Promise.reject(new Error('spawn failed'))
        : Promise.resolve(recovered),
    );
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 0.5,
    });

    runtime.onModuleInit();
    await flushAsync();

    // Exhaust the fast budget so the record settles.
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    await flushAsync();
    const settledCalls = clientFactory.mock.calls.length;

    // Cadence is the distinguishing property, not merely "it retries again":
    // unbounded exponential backoff would keep firing every 5 minutes here.
    // A settled record must be quiet through that window.
    await vi.advanceTimersByTimeAsync(20 * MINUTE_MS);
    await flushAsync();
    expect(clientFactory.mock.calls.length).toBe(settledCalls);

    // The host condition clears; the periodic occasion must still retry it.
    failing = false;
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    await flushAsync();

    expect(clientFactory.mock.calls.length).toBeGreaterThan(settledCalls);
    expect(recovered.discover).toHaveBeenCalled();

    await runtime.onModuleDestroy();
  });

  // A child that reaches `ready` and then exits is the shape the plain
  // attempt counter could not settle: every brief success refunded the budget,
  // so the ladder restarted forever and llame respawned the server about once
  // a second for as long as it stayed configured.
  it('settles a child that keeps exiting right after discovery', async () => {
    vi.useFakeTimers();
    const disconnects: Array<() => void> = [];
    const clientFactory = vi.fn<McpRuntimeClientFactory>((config) => {
      disconnects.push(config.onDisconnect ?? (() => undefined));
      return Promise.resolve(fakeClient());
    });
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();

    // Each spawn serves discovery and then dies immediately — far short of
    // the stability window that earns a fresh budget.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      disconnects.at(-1)?.();
      await flushAsync();
      await vi.advanceTimersByTimeAsync(30_000);
      await flushAsync();
    }

    // Bounded, not unbounded: the count is the budget plus the settled
    // record's occasional periodic recovery, nowhere near one per cycle.
    expect(clientFactory.mock.calls.length).toBeLessThanOrEqual(
      STDIO_MAX_FAST_ATTEMPTS + 2,
    );

    await runtime.onModuleDestroy();
  });

  it('refunds the retry budget to a session that stayed up', async () => {
    vi.useFakeTimers();
    const disconnects: Array<() => void> = [];
    const clientFactory = vi.fn<McpRuntimeClientFactory>((config) => {
      disconnects.push(config.onDisconnect ?? (() => undefined));
      return Promise.resolve(fakeClient());
    });
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();

    // A long healthy run, then a single blip. This must not be mistaken for a
    // crash loop — the fast ladder is exactly right for it.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await vi.advanceTimersByTimeAsync(5 * MINUTE_MS);
      disconnects.at(-1)?.();
      await flushAsync();
      await vi.advanceTimersByTimeAsync(5000);
      await flushAsync();
    }

    expect(clientFactory.mock.calls.length).toBe(5);

    await runtime.onModuleDestroy();
  });

  // Task 2.3 — the remote path keeps its unbounded reconnect.
  it('leaves remote reconnect unbounded', async () => {
    vi.useFakeTimers();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.reject(new Error('endpoint down')),
    );
    const runtime = new McpRuntimeService(servers('web'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();

    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    await flushAsync();

    // No ceiling applies to a remote server: it keeps trying.
    expect(clientFactory.mock.calls.length).toBeGreaterThan(
      STDIO_MAX_FAST_ATTEMPTS + 1,
    );

    await runtime.onModuleDestroy();
  });

  // Task 2.4 — the factory receives a transport-appropriate config.
  it('dispatches the client factory on the transport discriminator', async () => {
    const seen: Array<unknown> = [];
    const clientFactory = vi.fn<McpRuntimeClientFactory>((config) => {
      seen.push(config);
      return Promise.resolve(fakeClient());
    });
    const runtime = new McpRuntimeService(
      { ...stdioServers('local'), ...servers('web') },
      { clientFactory, random: () => 0.5 },
    );

    runtime.onModuleInit();
    await flushAsync();

    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual(
      expect.objectContaining({ serverId: 'local', command: 'node' }),
    );
    expect(seen).toContainEqual(
      expect.objectContaining({
        serverId: 'web',
        url: 'https://web.example.test/mcp',
      }),
    );

    await runtime.onModuleDestroy();
  });
});
