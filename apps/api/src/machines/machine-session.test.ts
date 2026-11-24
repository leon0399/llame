import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_PROTOCOL_VERSION, type HelloResult, type JsonValue } from '@workspace/machine-protocol';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';
import { MachineSession, type MachineSessionOptions } from './machine-session';

const hello: HelloResult = {
  protocolVersion: MACHINE_PROTOCOL_VERSION,
  daemonVersion: '1.0.0',
  roots: ['/srv/workspace'],
  methods: ['git.inspect'],
  instanceId: '11111111-1111-4111-8111-111111111111',
  buildId: '0123456789ab',
  facts: { os: 'linux', arch: 'x64', kernel: 'test', cpuCount: 2, totalMemoryBytes: 4096, rootDisks: [] },
};
const sessions: MachineSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

function transport(): MachineTransport {
  const ended = Promise.withResolvers<MachineLinkEnd>();
  return {
    input: new PassThrough(),
    output: new PassThrough(),
    close() { ended.resolve({ code: 0, signal: null, diagnostic: '', closedByHub: true }); },
    ended: ended.promise,
  };
}

function makeSession(options: Partial<MachineSessionOptions> = {}): MachineSession {
  const session = new MachineSession({
    name: 'devl',
    transport: transport(),
    hubVersion: '9.9.9',
    requestHandler: async (method) => method === 'hello' ? hello as unknown as JsonValue : {},
    ...options,
  });
  sessions.push(session);
  return session;
}

describe('MachineSession Connect-ES adapter', () => {
  it('handshakes with the exact protocol version and exposes identity, facts, and roots', async () => {
    const requestHandler = vi.fn(async (method: string) => method === 'hello' ? hello as unknown as JsonValue : {});
    const session = makeSession({ requestHandler });

    await expect(session.ready()).resolves.toEqual(hello);
    expect(requestHandler).toHaveBeenCalledWith(
      'hello',
      { protocolVersion: MACHINE_PROTOCOL_VERSION, hubVersion: '9.9.9' },
      expect.objectContaining({ budgetMs: 30_000 }),
    );
    expect(session.isReady).toBe(true);
  });

  it('dispatches unary calls with their method, params, and request budget', async () => {
    const requestHandler = vi.fn(async () => ({ kind: 'file', size: 12 }));
    const session = makeSession({ requestHandler });
    const params = { envelope: { budgetMs: 750 }, path: '/srv/workspace/readme.txt' };

    await expect(session.request({ method: 'fs.stat', params })).resolves.toEqual({ kind: 'file', size: 12 });
    expect(requestHandler).toHaveBeenCalledWith('fs.stat', params, {});
  });

  it('bridges Connect server-stream notifications through an open channel', async () => {
    const streamHandler = vi.fn(async (
      _method: string,
      _params: Record<string, unknown>,
      notify: (notification: { readonly method: string; readonly params?: JsonValue }) => void,
      _send: (frame: unknown) => void,
      _options: object,
    ) => {
      await Promise.resolve();
      notify({ method: 'mcp.message', params: { message: 'ready' } });
      return { protectedValues: [] };
    });
    const session = makeSession({ streamHandler });
    const notification = vi.fn();
    const handle = session.openChannel({
      method: 'mcp.open',
      params: { envelope: { budgetMs: 5_000 }, root: '/srv/workspace', server: 'repo' },
    });
    handle.channel.onNotification(notification);

    await expect(handle.result).resolves.toEqual({ protectedValues: [] });
    expect(streamHandler).toHaveBeenCalledWith(
      'mcp.open',
      expect.objectContaining({ root: '/srv/workspace', server: 'repo' }),
      expect.any(Function),
      expect.any(Function),
      {},
    );
    expect(notification).toHaveBeenCalledWith({ method: 'mcp.message', params: { message: 'ready' } });
    handle.channel.close();
  });
});

