import { PassThrough } from 'node:stream';
import { createRouterTransport } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BootstrapService,
  GetInfoResponseSchema,
  GetLimitsResponseSchema,
  ListRootsResponseSchema,
  MachineService,
  MACHINE_PROTOCOL_VERSION,
  type HelloResult,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';
import {
  MachineSession,
  type MachineRequestHandler,
  type MachineRequestOptions,
  type MachineSessionOptions,
  type MachineStreamInvocation,
} from './machine-session';
import { MachineIdentityMismatchError } from './machine-session-errors';

const hello = {
  protocolVersion: MACHINE_PROTOCOL_VERSION,
  daemonVersion: '1.0.0',
  roots: ['/srv/workspace'],
  instanceId: '11111111-1111-4111-8111-111111111111',
  buildId: '0123456789ab',
  facts: {
    os: 'linux',
    arch: 'x64',
    kernel: 'test',
    cpuCount: 2,
    totalMemoryBytes: 4096,
    rootDisks: [],
  },
} satisfies HelloResult;

function requestHandlerFor(
  fallback: JsonValue,
  helloAnswer: JsonValue = hello,
): MachineRequestHandler {
  function handler(
    method: 'hello',
    params: { readonly protocolVersion: number; readonly hubVersion: string },
    options: MachineRequestOptions,
  ): Promise<JsonValue>;
  function handler<M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions,
  ): Promise<JsonValue>;
  function handler(method: string): Promise<JsonValue> {
    return Promise.resolve(method === 'hello' ? helloAnswer : fallback);
  }

  return handler;
}

const sessions: Array<MachineSession> = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

function transport(): MachineTransport {
  const ended = Promise.withResolvers<MachineLinkEnd>();

  return {
    input: new PassThrough(),
    output: new PassThrough(),
    close() {
      ended.resolve({
        code: 0,
        signal: null,
        diagnostic: '',
        closedByHub: true,
      });
    },
    ended: ended.promise,
  };
}

function makeSession(
  options: Partial<MachineSessionOptions> = {},
): MachineSession {
  const session = new MachineSession({
    name: 'devl',
    transport: transport(),
    hubVersion: '9.9.9',
    requestHandler: requestHandlerFor({}),
    ...options,
  });

  sessions.push(session);

  return session;
}

function routerSession(
  calls: Array<string>,
  admitIdentity: (instanceId: string) => Promise<void>,
): MachineSession {
  const rpcTransport = createRouterTransport((router) => {
    router.service(BootstrapService, {
      getInfo: () => {
        calls.push('GetInfo');

        return create(GetInfoResponseSchema, {
          instanceId: hello.instanceId,
          release: hello.daemonVersion,
          buildId: hello.buildId,
          protocolVersion: MACHINE_PROTOCOL_VERSION,
        });
      },
    });
    router.service(MachineService, {
      listRoots: () => {
        calls.push('ListRoots');

        return create(ListRootsResponseSchema, {
          roots: [{ path: '/srv/workspace' }],
        });
      },
      getLimits: () => {
        calls.push('GetLimits');

        return create(GetLimitsResponseSchema, {});
      },
    });
  });

  const ended = Promise.withResolvers<MachineLinkEnd>();

  const session = new MachineSession({
    name: 'devl',
    transport: {
      rpcTransport,
      close: () =>
        ended.resolve({
          code: 0,
          signal: null,
          diagnostic: '',
          closedByHub: true,
        }),
      ended: ended.promise,
    },
    hubVersion: '9.9.9',
    admitIdentity: async (instanceId) => {
      calls.push('admitIdentity');
      await admitIdentity(instanceId);
    },
  });

  sessions.push(session);

  return session;
}

describe('MachineSession Connect-ES adapter', () => {
  it('refuses a hello without an instance id before calling the Machine service', async () => {
    const helloWithoutInstanceId: JsonValue = {
      protocolVersion: MACHINE_PROTOCOL_VERSION,
      daemonVersion: '1.0.0',
      roots: ['/srv/workspace'],
      buildId: '0123456789ab',
      facts: {
        os: 'linux',
        arch: 'x64',
        kernel: 'test',
        cpuCount: 2,
        totalMemoryBytes: 4096,
        rootDisks: [],
      },
    };

    const session = makeSession({
      requestHandler: requestHandlerFor({}, helloWithoutInstanceId),
    });

    const getInfo = vi.spyOn(session.clients.bootstrap, 'getInfo');
    const listRoots = vi.spyOn(session.clients.machine, 'listRoots');

    await expect(session.ready()).rejects.toThrow(
      'The Machine answered an unusable handshake.',
    );
    expect(getInfo).not.toHaveBeenCalled();
    expect(listRoots).not.toHaveBeenCalled();
  });

  it('handshakes with the exact protocol version and exposes identity, facts, and roots', async () => {
    const handler = { request: requestHandlerFor({}) };
    const requestSpy = vi.spyOn(handler, 'request');
    const session = makeSession({ requestHandler: handler.request });

    await expect(session.ready()).resolves.toEqual(hello);
    expect(requestSpy).toHaveBeenCalledWith(
      'hello',
      { protocolVersion: MACHINE_PROTOCOL_VERSION, hubVersion: '9.9.9' },
      expect.objectContaining({ budgetMs: 30_000 }),
    );
    expect(session.isReady).toBe(true);
  });

  it('dispatches unary calls with their method, params, and request budget', async () => {
    const handler = {
      request: requestHandlerFor({ kind: 'file', size: 12 }),
    };

    const requestSpy = vi.spyOn(handler, 'request');
    const session = makeSession({ requestHandler: handler.request });

    const params = {
      envelope: { budgetMs: 750 },
      path: '/srv/workspace/readme.txt',
    };

    await expect(
      session.request({ method: 'fs.stat', params }),
    ).resolves.toEqual({ kind: 'file', size: 12 });
    expect(requestSpy).toHaveBeenCalledWith('fs.stat', params, {});
  });

  it('bridges Connect server-stream notifications through an open channel', async () => {
    const invocationReady = Promise.withResolvers<MachineStreamInvocation>();

    const streamHandler = vi.fn((invocation: MachineStreamInvocation) => {
      queueMicrotask(() =>
        invocation.notify({
          method: 'mcp.message',
          params: { message: 'ready' },
        }),
      );
      invocationReady.resolve(invocation);

      return Promise.resolve({ protectedValues: [] });
    });

    const session = makeSession({ streamHandler });
    const notification = vi.fn();

    const handle = session.openChannel({
      method: 'mcp.open',
      params: {
        envelope: { budgetMs: 5000 },
        root: '/srv/workspace',
        server: 'repo',
      },
    });

    handle.channel.onNotification(notification);

    await expect(handle.result).resolves.toEqual({ protectedValues: [] });
    expect(handle.channel.closed).toBe(false);
    expect(session.openStreams).toBe(1);
    const invocation = await invocationReady.promise;
    invocation.notify({
      method: 'mcp.message',
      params: { message: 'after open resolves' },
    });
    expect(notification).toHaveBeenNthCalledWith(2, {
      method: 'mcp.message',
      params: { message: 'after open resolves' },
    });
    handle.channel.close();
    expect(session.openStreams).toBe(0);
    expect(invocation.method).toBe('mcp.open');
    expect(invocation.params).toMatchObject({
      root: '/srv/workspace',
      server: 'repo',
    });
    expect(notification).toHaveBeenNthCalledWith(1, {
      method: 'mcp.message',
      params: { message: 'ready' },
    });
    expect(handle.channel.closed).toBe(true);
  });
  it('admits identity after GetInfo and before roots and limits on a Connect router', async () => {
    const calls: Array<string> = [];
    const session = routerSession(calls, async () => {});

    await session.ready();

    expect(calls).toEqual([
      'GetInfo',
      'admitIdentity',
      'ListRoots',
      'GetLimits',
    ]);
  });

  it('does not call roots or limits when identity admission fails', async () => {
    const calls: Array<string> = [];

    const session = routerSession(calls, () =>
      Promise.reject(new MachineIdentityMismatchError('devl')),
    );

    await expect(session.ready()).rejects.toBeInstanceOf(
      MachineIdentityMismatchError,
    );

    expect(calls).toEqual(['GetInfo', 'admitIdentity']);
  });
});
