import { MachineProtocolError } from '@workspace/machine-protocol';

import { createProtocolPeer, type ProtocolPeerOptions } from '../testing/machine-protocol-peer';

import { MachineConnector } from './machine-connector.service';
import { MachineUnavailableError } from './machine-session';
import type { MachineContact } from './machines-status';

/** Every request carries its own budget; the envelope is part of the params. */
const ENVELOPE = { budgetMs: 30_000 };

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' }, gpu: { destination: 'me@gpu.lan:2222' } },
};

type Fixture = {
  readonly connector: MachineConnector;
  readonly peer: ReturnType<typeof createProtocolPeer>;
  readonly contacts: Array<MachineContact>;
  /** Waits until `count` contact events have been recorded. */
  readonly awaitContacts: (count: number) => Promise<void>;
  readonly sessionCount: () => number;
};

function fixture(
  options: ProtocolPeerOptions & {
    readonly idleCloseMs?: number;
    readonly handshakeTimeoutMs?: number;
  } = {},
): Fixture {
  const peer = createProtocolPeer(options);
  const contacts: Array<MachineContact> = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    transportFactory: peer.factory,
    onContact: (contact) => {
      contacts.push(contact);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter === undefined || contacts.length < waiter.count) continue;
        waiters.splice(index, 1);
        waiter.resolve();
      }
    },
    idleCloseMs: options.idleCloseMs ?? 5 * 60_000,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 2000,
    now: () => 1_700_000_000_000,
  });
  return {
    connector,
    peer,
    contacts,
    sessionCount: () => peer.sessions.length,
    awaitContacts: (count: number) => {
      if (contacts.length >= count) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push({ count, resolve });
      return promise;
    },
  };
}

/** The rejection reason as an Error, so an assertion can read it. */
function rejection(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The refusal a call failed with, for assertions. */
function refusal(error: unknown): MachineUnavailableError {
  if (error instanceof MachineUnavailableError) return error;
  throw error;
}

describe('MachineConnector configuration surface', () => {
  it('is absent without a machines section', async () => {
    const connector = new MachineConnector({ machines: undefined, hubVersion: '1' });
    expect(connector.enabled()).toBe(false);
    expect(connector.names()).toEqual([]);
    expect(connector.isConfigured('devl')).toBe(false);
    await expect(connector.request('devl', 'roots.list', { envelope: ENVELOPE })).rejects.toThrow(
      MachineUnavailableError,
    );
  });

  it('lists the configured Machines in configuration order', () => {
    const { connector } = fixture();
    expect(connector.enabled()).toBe(true);
    expect(connector.names()).toEqual(['devl', 'gpu']);
    expect(connector.isConfigured('devl')).toBe(true);
    expect(connector.isConfigured('toString')).toBe(false);
    expect(connector.isConfigured('nope')).toBe(false);
  });

  it('refuses an unconfigured Machine without opening a link', async () => {
    const { connector, sessionCount } = fixture();
    const error = refusal(
      await connector.request('nope', 'roots.list', { envelope: ENVELOPE }).catch((error: unknown) => rejection(error)),
    );
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(sessionCount()).toBe(0);
  });
});

describe('MachineConnector session lifecycle', () => {
  it('handshakes once and answers a request over that session', async () => {
    const { connector, peer, contacts, sessionCount } = fixture({
      roots: ['/srv/app'],
      daemonVersion: '1.2.3',
      answers: { 'roots.list': { value: { roots: ['/srv/app'] } } },
    });
    await expect(
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }, { budgetMs: 500 }),
    ).resolves.toEqual({ roots: ['/srv/app'] });
    expect(sessionCount()).toBe(1);
    expect(peer.sessions[0]?.requests).toEqual(['roots.list']);
    expect(contacts).toEqual([
      {
        name: 'devl',
        at: new Date(1_700_000_000_000),
        hubProtocolVersion: 1,
        daemonProtocolVersion: 1,
        daemonVersion: '1.2.3',
        roots: ['/srv/app'],
      },
    ]);
  });

  it('opens a second session after the first ended', async () => {
    const { connector, peer, sessionCount, awaitContacts } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    const first = await peer.session(0);
    first.drop();
    await awaitContacts(2);
    await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    expect(sessionCount()).toBe(2);
  });

  it('carries concurrent requests on one session without serializing them', async () => {
    const { connector, peer, sessionCount } = fixture({
      answers: { 'roots.list': { hold: true } },
    });
    const first = connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    const second = connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    const session = await peer.session(0);
    await session.awaitRequests(2);
    expect(sessionCount()).toBe(1);
    expect(session.maxOpenStreams).toBe(2);
    session.release('roots.list', { roots: ['/a'] });
    session.release('roots.list', { roots: ['/b'] });
    await expect(first).resolves.toEqual({ roots: ['/a'] });
    await expect(second).resolves.toEqual({ roots: ['/b'] });
  });

  it('shares one open between simultaneous first calls', async () => {
    const { connector, sessionCount } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    await Promise.all([
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
    ]);
    expect(sessionCount()).toBe(1);
  });

  it('closes an idle session politely, reporting no failure', async () => {
    vi.useFakeTimers();
    try {
      const { connector, peer, contacts, sessionCount } = fixture({
        idleCloseMs: 20,
        answers: { 'roots.list': { value: { roots: [] } } },
      });
      await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
      const session = await peer.session(0);
      expect(session.stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(25);
      expect(session.stopped).toBe(true);
      expect(contacts).toHaveLength(1);
      await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
      expect(sessionCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a session alive while a stream is open', async () => {
    vi.useFakeTimers();
    try {
      const { connector, peer } = fixture({
        idleCloseMs: 20,
        answers: { 'mcp.open': { hold: true } },
      });
      const handle = await connector.openChannel('devl', 'mcp.open', {
        root: '/srv/app',
        server: 'repo',
        envelope: ENVELOPE,
      });
      const session = await peer.session(0);
      session.release('mcp.open', { protectedValues: ['token'] }, true);
      await expect(handle.result).resolves.toEqual({ protectedValues: ['token'] });
      await vi.advanceTimersByTimeAsync(100);
      expect(session.stopped).toBe(false);
      handle.channel.close();
      await vi.advanceTimersByTimeAsync(25);
      expect(session.stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MachineConnector failure classification', () => {
  it('reports a session lost after the request was sent as sent', async () => {
    const { connector, peer, contacts, awaitContacts } = fixture({
      answers: { 'fs.edit': { hold: true } },
    });
    const call = connector.request('devl', 'fs.edit', {
      oldText: 'a',
      newText: 'b',
      path: '/srv/app/a.ts',
      options: { displayPrefix: 'machine://devl' },
      envelope: ENVELOPE,
    });
    const outcome = call.catch((error: unknown) => rejection(error));
    const session = await peer.session(0);
    await session.awaitRequests(1);
    session.drop({ code: 255, diagnostic: 'Connection reset by peer' });
    const error = refusal(await outcome);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(true);
    await awaitContacts(2);
    expect(contacts.at(-1)).toMatchObject({ name: 'devl', failure: 'session_lost' });
  });

  it('reports a failed open as unsent and unreachable', async () => {
    const { connector, sessionCount } = fixture({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });
    const error = refusal(
      await connector.request('devl', 'roots.list', { envelope: ENVELOPE }).catch((error: unknown) => rejection(error)),
    );
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(sessionCount()).toBe(0);
  });

  it.each([
    ['Host key verification failed.', 'host_key_mismatch'],
    ['me@box: Permission denied (publickey).', 'auth_failed'],
    ['ssh: connect to host box port 22: No route to host', 'unreachable'],
  ])('maps %s to %s before the handshake', async (diagnostic, reason) => {
    const { connector, peer, contacts, awaitContacts } = fixture({ silentHello: true });
    const call = connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    const outcome = call.catch((error: unknown) => rejection(error));
    const session = await peer.session(0);
    session.drop({ diagnostic });
    const error = refusal(await outcome);
    expect(error.reason).toBe(reason);
    expect(error.sent).toBe(false);
    await awaitContacts(1);
    expect(contacts.at(-1)).toMatchObject({ failure: reason });
  });

  it('reports an incompatible daemon when the handshake is refused', async () => {
    const { connector, contacts, awaitContacts } = fixture({
      helloProtocolVersion: 7,
      handshakeTimeoutMs: 500,
    });
    const error = refusal(
      await connector.request('devl', 'roots.list', { envelope: ENVELOPE }).catch((error: unknown) => rejection(error)),
    );
    expect(error.reason).toBe('incompatible_version');
    expect(error.sent).toBe(false);
    await awaitContacts(1);
    expect(contacts.at(-1)).toMatchObject({ failure: 'incompatible_version' });
  });

  it('reports a silent Machine as unreachable when the handshake times out', async () => {
    vi.useFakeTimers();
    try {
      const { connector } = fixture({ silentHello: true, handshakeTimeoutMs: 20 });
      const outcome = connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error));
      await vi.advanceTimersByTimeAsync(25);
      const error = refusal(await outcome);
      expect(error.reason).toBe('unreachable');
      expect(error.sent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes a Machine refusal through as the protocol error it is', async () => {
    const { connector } = fixture({ answers: { 'fs.stat': { error: 'budget_exhausted' } } });
    const error = await connector
      .request('devl', 'fs.stat', { path: '/srv/app/a', envelope: ENVELOPE })
      .catch((error: unknown) => rejection(error));
    expect(error).toBeInstanceOf(MachineProtocolError);
    if (!(error instanceof MachineProtocolError)) throw new Error('not the protocol error');
    expect(error.code).toBe('budget_exhausted');
  });

  it('treats a caller cancellation as a cancellation, not a Machine failure', async () => {
    const { connector, peer } = fixture({ answers: { 'fs.edit': { hold: true } } });
    const controller = new AbortController();
    const call = connector.request(
      'devl',
      'fs.edit',
      {
        oldText: 'a',
        newText: 'b',
        path: '/srv/app/a.ts',
        options: { displayPrefix: 'machine://devl' },
        envelope: ENVELOPE,
      },
      { signal: controller.signal },
    );
    const outcome = call.catch((error: unknown) => rejection(error));
    const session = await peer.session(0);
    await session.awaitRequests(1);
    controller.abort();
    const error = await outcome;
    expect(error).not.toBeInstanceOf(MachineUnavailableError);
  });

  it('fails a signal aborted before dispatch without reaching the Machine', async () => {
    const { connector, sessionCount } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/iu);
    expect(sessionCount()).toBe(0);
  });
});

describe('MachineConnector reachability', () => {
  it('decides once per attempt and never re-opens a hopeless session', async () => {
    let offline = true;
    const { connector, sessionCount } = fixture({
      openFailure: () =>
        offline ? 'ssh: connect to host box port 22: Connection refused' : undefined,
    });
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    expect(sessionCount()).toBe(0);
    offline = false;
    // The same attempt keeps its verdict even after the Machine recovered.
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    expect(sessionCount()).toBe(0);
    await expect(connector.reachable('devl', 'attempt-2')).resolves.toBe(true);
    expect(sessionCount()).toBe(1);
  });

  it('does not probe an unconfigured or absent Machine', async () => {
    const { connector } = fixture();
    await expect(connector.reachable('nope', 'attempt-1')).resolves.toBe(false);
    const absent = new MachineConnector({ machines: undefined, hubVersion: '1' });
    await expect(absent.reachable('devl', 'attempt-1')).resolves.toBe(false);
  });

  it('answers the same verdict to concurrent asks in one attempt', async () => {
    const { connector, sessionCount } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    const verdicts = await Promise.all([
      connector.reachable('devl', 'attempt-9'),
      connector.reachable('devl', 'attempt-9'),
      connector.reachable('devl', 'attempt-9'),
    ]);
    expect(verdicts).toEqual([true, true, true]);
    expect(sessionCount()).toBe(1);
  });
});

describe('MachineConnector mutation serialization', () => {
  it('runs one Machine mutation at a time, in order', async () => {
    const { connector } = fixture();
    const events: Array<string> = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = connector.serializeMutation('devl', async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = connector.serializeMutation('devl', () => {
      events.push('second:start');
      return Promise.resolve();
    });
    release?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('keeps Machines independent and survives a failed mutation', async () => {
    const { connector } = fixture();
    const events: Array<string> = [];
    const failed = connector.serializeMutation('devl', () => {
      events.push('devl:fail');
      return Promise.reject(new Error('nope'));
    });
    const other = connector.serializeMutation('gpu', () => {
      events.push('gpu:ok');
      return Promise.resolve();
    });
    await expect(failed).rejects.toThrow('nope');
    await other;
    await connector.serializeMutation('devl', () => {
      events.push('devl:next');
      return Promise.resolve();
    });
    expect(events).toEqual(['devl:fail', 'gpu:ok', 'devl:next']);
  });
});

describe('MachineConnector channels', () => {
  it('delivers notifications and closes when the caller stops the channel', async () => {
    const { connector, peer } = fixture({ answers: { 'mcp.open': { hold: true } } });
    const handle = await connector.openChannel('devl', 'mcp.open', {
      root: '/srv/app',
      server: 'repo',
      envelope: ENVELOPE,
    });
    const session = await peer.session(0);
    session.release('mcp.open', { protectedValues: ['token'] }, true);
    await expect(handle.result).resolves.toEqual({ protectedValues: ['token'] });
    const seen: Array<string> = [];
    const notified = Promise.withResolvers<void>();
    handle.channel.onNotification((message) => {
      seen.push(message.method);
      notified.resolve();
    });
    session.notify('mcp.open', 'mcp.stderr', { text: 'listening' });
    await notified.promise;
    expect(seen).toEqual(['mcp.stderr']);
    const closed = Promise.withResolvers<void>();
    handle.channel.onClose(() => closed.resolve());
    handle.channel.close();
    await closed.promise;
  });

  it('reports a channel lost with the session as sent', async () => {
    const { connector, peer } = fixture({ answers: { 'mcp.open': { hold: true } } });
    const handle = await connector.openChannel('devl', 'mcp.open', {
      root: '/srv/app',
      server: 'repo',
      envelope: ENVELOPE,
    });
    const outcome = handle.result.catch((error: unknown) => rejection(error));
    const session = await peer.session(0);
    await session.awaitRequests(1);
    session.drop({ diagnostic: 'Connection reset by peer' });
    const error = refusal(await outcome);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(true);
  });
});

describe('MachineConnector shutdown', () => {
  it('closes every session', async () => {
    const { connector, peer } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    const session = await peer.session(0);
    connector.onModuleDestroy();
    await session.awaitStop();
    expect(session.stopped).toBe(true);
  });
});
