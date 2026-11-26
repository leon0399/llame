import {
  MachineProtocolError,
  PROTOCOL_VERSION,
} from '@workspace/machine-protocol';

import type { MachinesConfig } from '../instance-config/machines-config';
import {
  createProtocolPeer,
  defaultPeerFacts,
  DEFAULT_PEER_INSTANCE_ID,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';

import {
  MachineConnector,
  REACHABILITY_CACHE_LIMIT,
  type MachineConnectorDeps,
} from './machine-connector.service';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from './machine-session-errors';
import type { MachineContact } from './machines-status';

/** Every request carries its own budget; the envelope is part of the params. */
const ENVELOPE = { budgetMs: 30_000 };

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: {
    devl: { destination: 'box' },
    gpu: { destination: 'me@gpu.lan:2222' },
  },
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
    readonly bindIdentity?: MachineConnectorDeps['bindIdentity'];
    readonly logger?: MachineConnectorDeps['logger'];
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
    bindIdentity: options.bindIdentity ?? (() => Promise.resolve('match')),
    logger: options.logger,
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

/** Let the peer's own stream callbacks run, with no guessed delay. */
async function settle(): Promise<void> {
  const turn = Promise.withResolvers<void>();
  setImmediate(turn.resolve);
  await turn.promise;
  await Promise.resolve();
}

describe('MachineConnector configuration surface', () => {
  it('is absent without a machines section', async () => {
    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: '1',
      bindIdentity: () => Promise.resolve('match'),
    });

    expect(connector.enabled()).toBe(false);
    expect(connector.names()).toEqual([]);
    expect(connector.isConfigured('devl')).toBe(false);
    await expect(
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
    ).rejects.toThrow(MachineUnavailableError);
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
    const { connector, contacts, sessionCount } = fixture();

    const error = refusal(
      await connector
        .request('nope', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.machine).toBe('nope');
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('This Machine is not configured.');
    expect(contacts).toHaveLength(0);
    expect(sessionCount()).toBe(0);
  });

  it('refuses a declared host that names no destination', async () => {
    const peer = createProtocolPeer({
      answers: { 'roots.list': { value: { roots: [] } } },
    });

    // `null` is what a bare YAML `devl:` (or JSON `"devl": null`) yields. The
    // operator loader's schema rejects that shape before a connector is built,
    // so this guard is the connector's own last line of defence.
    const machines: MachinesConfig = {
      ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
      hosts: { devl: { destination: 'box' } },
    };

    Object.defineProperty(machines.hosts, 'devl', {
      value: null,
      enumerable: true,
    });

    const connector = new MachineConnector({
      machines,
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.machine).toBe('devl');
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    // A declared entry with no destination is a Machine this process cannot
    // reach; the local entry is the one that needs none.
    expect(error.message).toBe('This process cannot reach this Machine.');
    expect(peer.sessions).toHaveLength(0);
  });

  it('refuses a Machines section that carries no SSH settings', async () => {
    const machines: MachinesConfig = {
      ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
      hosts: { devl: { destination: 'box' } },
    };

    // The loader always resolves `ssh` (defaulting the pinned known-hosts
    // file); drop it so the factory's own guard is the only thing left with no
    // transport injected.
    Reflect.deleteProperty(machines, 'ssh');

    const connector = new MachineConnector({
      machines,
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.machine).toBe('machine');
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('No Machine SSH settings are configured.');
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
      connector.request(
        'devl',
        'roots.list',
        { envelope: ENVELOPE },
        { budgetMs: 500 },
      ),
    ).resolves.toEqual({ roots: ['/srv/app'] });
    expect(sessionCount()).toBe(1);
    expect(peer.sessions[0]?.requests).toEqual(['roots.list']);
    expect(contacts).toEqual([
      {
        name: 'devl',
        at: new Date(1_700_000_000_000),
        hubProtocolVersion: PROTOCOL_VERSION,
        daemonProtocolVersion: PROTOCOL_VERSION,
        daemonVersion: '1.2.3',
        roots: ['/srv/app'],
        facts: defaultPeerFacts(['/srv/app']),
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

    const first = connector.request('devl', 'roots.list', {
      envelope: ENVELOPE,
    });

    const second = connector.request('devl', 'roots.list', {
      envelope: ENVELOPE,
    });

    const session = await peer.session(0);
    await session.awaitRequests(2);
    expect(sessionCount()).toBe(1);
    expect(session.requests).toHaveLength(2);
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

  it('defers the idle close on every request', async () => {
    vi.useFakeTimers();

    try {
      const { connector, peer } = fixture({
        idleCloseMs: 20,
        answers: { 'roots.list': { value: { roots: [] } } },
      });

      await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
      const session = await peer.session(0);
      await vi.advanceTimersByTimeAsync(10);
      // The open armed the close; this request must push it out again.
      await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
      await vi.advanceTimersByTimeAsync(15);
      expect(session.stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(session.stopped).toBe(true);
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
      await expect(handle.result).resolves.toEqual({
        protectedValues: ['token'],
      });
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
    expect(contacts.at(-1)).toMatchObject({
      name: 'devl',
      failure: 'session_lost',
    });
  });

  it('reports a failed open as unsent and unreachable', async () => {
    const { connector, sessionCount } = fixture({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    // The test transport records the attempted link, even when its hello fails.
    expect(sessionCount()).toBe(1);
  });

  it.each([
    ['Host key verification failed.', 'host_key_mismatch'],
    ['me@box: Permission denied (publickey).', 'auth_failed'],
    ['ssh: connect to host box port 22: No route to host', 'unreachable'],
  ])('maps %s to %s before the handshake', async (diagnostic, reason) => {
    const { connector, peer, contacts, awaitContacts } = fixture({
      silentHello: true,
    });

    const call = connector.request('devl', 'roots.list', {
      envelope: ENVELOPE,
    });

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
      helloProtocolVersion: 6,
      handshakeTimeoutMs: 500,
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.reason).toBe('incompatible_version');
    expect(error.sent).toBe(false);
    await awaitContacts(1);
    expect(contacts.at(-1)).toMatchObject({ failure: 'incompatible_version' });
  });

  it('reports a silent Machine as unreachable when the handshake times out', async () => {
    vi.useFakeTimers();

    try {
      const { connector } = fixture({
        silentHello: true,
        handshakeTimeoutMs: 20,
      });

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
    const { connector } = fixture({
      answers: { 'fs.stat': { error: 'budget_exhausted' } },
    });

    const error = await connector
      .request('devl', 'fs.stat', { path: '/srv/app/a', envelope: ENVELOPE })
      .catch((error: unknown) => rejection(error));

    expect(error).toBeInstanceOf(MachineProtocolError);

    if (!(error instanceof MachineProtocolError))
      throw new Error('not the protocol error');
    expect(error.code).toBe('budget_exhausted');
  });

  it('treats a caller cancellation as a cancellation, not a Machine failure', async () => {
    const { connector, peer } = fixture({
      answers: { 'fs.edit': { hold: true } },
    });

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
      connector.request(
        'devl',
        'roots.list',
        { envelope: ENVELOPE },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/iu);
    expect(sessionCount()).toBe(0);
  });
});

describe('MachineConnector reachability', () => {
  it('decides once per attempt and never re-opens a hopeless session', async () => {
    let offline = true;

    const { connector, sessionCount } = fixture({
      openFailure: () =>
        offline
          ? 'ssh: connect to host box port 22: Connection refused'
          : undefined,
    });

    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    expect(sessionCount()).toBe(1);
    offline = false;
    // The same attempt keeps its verdict even after the Machine recovered.
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(false);
    expect(sessionCount()).toBe(1);
    await expect(connector.reachable('devl', 'attempt-2')).resolves.toBe(true);
    expect(sessionCount()).toBe(2);
  });

  it('does not probe an unconfigured or absent Machine', async () => {
    const { connector } = fixture();
    await expect(connector.reachable('nope', 'attempt-1')).resolves.toBe(false);

    const absent = new MachineConnector({
      machines: undefined,
      hubVersion: '1',
      bindIdentity: () => Promise.resolve('match'),
    });

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

  it('records one contact for the handshake a probe performed', async () => {
    const { connector, contacts, sessionCount } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });

    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(true);
    expect(sessionCount()).toBe(1);
    expect(contacts).toHaveLength(1);
  });

  it('re-stamps the contact when the Machine already answered', async () => {
    const { connector, contacts } = fixture({
      roots: ['/srv/app'],
      daemonVersion: '1.2.3',
      answers: { 'roots.list': { value: { roots: ['/srv/app'] } } },
    });

    await connector.request('devl', 'roots.list', { envelope: ENVELOPE });
    expect(contacts).toHaveLength(1);
    // The session is already live, so probing it re-stamps liveness rather
    // than handshaking again: the status writer sees a fresh contact whose
    // facts are absent, so the stored facts keep their handshake capture time.
    await expect(connector.reachable('devl', 'attempt-1')).resolves.toBe(true);
    expect(contacts.at(1)).toEqual({
      name: 'devl',
      at: new Date(1_700_000_000_000),
      hubProtocolVersion: PROTOCOL_VERSION,
      daemonProtocolVersion: PROTOCOL_VERSION,
      daemonVersion: '1.2.3',
      roots: ['/srv/app'],
    });
    expect(contacts).toHaveLength(2);
  });

  it('keeps every verdict while the cache is still at its bound', async () => {
    let offline = true;

    const { connector, sessionCount } = fixture({
      openFailure: () =>
        offline
          ? 'ssh: connect to host box port 22: Connection refused'
          : undefined,
    });

    for (let index = 0; index < REACHABILITY_CACHE_LIMIT; index += 1) {
      await expect(
        connector.reachable('devl', `attempt-${index}`),
      ).resolves.toBe(false);
    }

    offline = false;
    // A full cache evicts nothing yet, so the oldest verdict still stands.
    await expect(connector.reachable('devl', 'attempt-0')).resolves.toBe(false);
    expect(sessionCount()).toBe(REACHABILITY_CACHE_LIMIT);
  });

  it('forgets the oldest verdict once the cache is over its bound', async () => {
    let offline = true;

    const { connector, sessionCount } = fixture({
      openFailure: () =>
        offline
          ? 'ssh: connect to host box port 22: Connection refused'
          : undefined,
    });

    for (let index = 0; index <= REACHABILITY_CACHE_LIMIT; index += 1) {
      await expect(
        connector.reachable('devl', `attempt-${index}`),
      ).resolves.toBe(false);
    }

    offline = false;
    // One attempt past the bound pushed `attempt-0` out, so it probes afresh.
    await expect(connector.reachable('devl', 'attempt-0')).resolves.toBe(true);
    expect(sessionCount()).toBe(REACHABILITY_CACHE_LIMIT + 2);
  });
});

describe('MachineConnector contact reporting', () => {
  it('logs a contact sink that fails without failing the call', async () => {
    const peer = createProtocolPeer({
      answers: { 'roots.list': { value: { roots: ['/srv/app'] } } },
    });

    const logged = vi.fn();

    const connector = new MachineConnector({
      machines: MACHINES,
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      onContact: () => {
        throw new Error('the status store is down');
      },
      logger: { error: logged },
    });

    await expect(
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
    ).resolves.toEqual({ roots: ['/srv/app'] });
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(
        'Recording the contact with Machine devl failed',
        expect.stringContaining('the status store is down'),
      );
    });
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
    const { connector, peer } = fixture({
      answers: { 'mcp.open': { hold: true } },
    });

    const handle = await connector.openChannel('devl', 'mcp.open', {
      root: '/srv/app',
      server: 'repo',
      envelope: ENVELOPE,
    });

    const session = await peer.session(0);
    session.release('mcp.open', { protectedValues: ['token'] }, true);
    await expect(handle.result).resolves.toEqual({
      protectedValues: ['token'],
    });
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
    const { connector, peer } = fixture({
      answers: { 'mcp.open': { hold: true } },
    });

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

describe('MachineConnector identity binding', () => {
  it('binds the handshake instance id before serving a request', async () => {
    const events: Array<string> = [];

    const bindIdentity = vi.fn<MachineConnectorDeps['bindIdentity']>(() => {
      events.push('bind');

      return Promise.resolve('bound');
    });

    const { connector, peer, contacts } = fixture({
      roots: ['/srv/app'],
      // The peer records the arrival of the request itself, so the two
      // events are ordered by observation rather than by assertion placement.
      answer: () => {
        events.push('request');

        return { value: { roots: ['/srv/app'] } };
      },
      bindIdentity,
    });

    await expect(
      connector.request('devl', 'roots.list', { envelope: ENVELOPE }),
    ).resolves.toEqual({ roots: ['/srv/app'] });

    expect(events).toEqual(['bind', 'request']);
    expect(bindIdentity).toHaveBeenCalledTimes(1);
    expect(bindIdentity).toHaveBeenCalledWith('devl', DEFAULT_PEER_INSTANCE_ID);
    expect((await peer.session(0)).requests).toEqual(['roots.list']);
    // The facts the handshake carried reach the status writer with the
    // contact, so the Machines list can show them without another handshake.
    expect(contacts).toEqual([
      {
        name: 'devl',
        at: new Date(1_700_000_000_000),
        hubProtocolVersion: PROTOCOL_VERSION,
        daemonProtocolVersion: PROTOCOL_VERSION,
        daemonVersion: '0.0.1',
        roots: ['/srv/app'],
        facts: defaultPeerFacts(['/srv/app']),
      },
    ]);
  });

  it('refuses a mismatched daemon before any request and reports the reason', async () => {
    const { connector, peer, contacts, awaitContacts } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
      bindIdentity: () => Promise.resolve('mismatch'),
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error).toBeInstanceOf(MachineIdentityMismatchError);
    expect(error.reason).toBe('identity_mismatch');
    expect(error.sent).toBe(false);
    const session = await peer.session(0);
    // Nothing but the handshake reached the daemon, and the session was closed
    // rather than left usable.
    expect(session.requests).toEqual([]);
    await session.awaitStop();
    expect(session.stopped).toBe(true);
    await awaitContacts(1);
    expect(contacts).toEqual([
      {
        name: 'devl',
        at: new Date(1_700_000_000_000),
        hubProtocolVersion: PROTOCOL_VERSION,
        failure: 'identity_mismatch',
      },
    ]);
  });

  it('fails closed when the binding cannot be read, recording no contact', async () => {
    const logger = { error: vi.fn() };

    const { connector, peer, contacts } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
      bindIdentity: () => Promise.reject(new Error('database unreachable')),
      logger,
    });

    const error = refusal(
      await connector
        .request('devl', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error).not.toBeInstanceOf(MachineIdentityMismatchError);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(false);
    expect(error.message).toBe(
      'The identity binding of this Machine could not be checked.',
    );
    expect((await peer.session(0)).requests).toEqual([]);
    // Give the session's own end handler a turn: a bind failure is not the
    // daemon's fault, so nothing is recorded against the Machine.
    await (await peer.session(0)).awaitStop();
    expect(contacts).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('holds a second request and a probe while the identity bind is pending', async () => {
    const pending = Promise.withResolvers<'match' | 'mismatch'>();
    const binding = Promise.withResolvers<void>();

    const bindIdentity = vi.fn<MachineConnectorDeps['bindIdentity']>(() => {
      binding.resolve();

      return pending.promise;
    });

    const { connector, peer, contacts, awaitContacts } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
      bindIdentity,
    });

    const first = connector
      .request('devl', 'roots.list', { envelope: ENVELOPE })
      .catch((error: unknown) => rejection(error));

    // The handshake is answered and the bind has started: the session is
    // ready but must not serve until the bind says it may.
    await binding.promise;

    const second = connector
      .request('devl', 'roots.list', { envelope: ENVELOPE })
      .catch((error: unknown) => rejection(error));

    const probe = connector.reachable('devl', 'attempt-1');

    const session = await peer.session(0);

    await settle();
    expect(session.requests).toEqual([]);
    expect(session.calls).toEqual([]);

    pending.resolve('mismatch');
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBeInstanceOf(MachineIdentityMismatchError);
    expect(b).toBeInstanceOf(MachineIdentityMismatchError);
    await expect(probe).resolves.toBe(false);
    expect(connector.lastRefusal('devl')).toBeInstanceOf(
      MachineIdentityMismatchError,
    );
    expect(session.requests).toEqual([]);
    await awaitContacts(1);
    expect(contacts.at(0)).toMatchObject({ failure: 'identity_mismatch' });
  });
});

describe('MachineConnector local Machine', () => {
  it('names this process’s Machine, its default, and what it can reach', () => {
    const connector = new MachineConnector({
      machines: {
        local: 'host-a',
        default: 'host-b',
        hosts: {
          'host-a': {},
          'host-b': { destination: 'box' },
          edge: {},
        },
      },
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
    });

    expect(connector.localMachine()).toBe('host-a');
    expect(connector.defaultMachine()).toBe('host-b');
    expect(connector.canReach('host-a')).toBe(true);
    expect(connector.canReach('host-b')).toBe(true);
    // Configured, but this process has no link to it.
    expect(connector.canReach('edge')).toBe(false);
    expect(connector.canReach('nope')).toBe(false);
  });

  it('opens the local entry without a destination through the local factory', async () => {
    const peer = createProtocolPeer({
      answers: { 'roots.list': { value: { roots: [] } } },
    });

    const opened: Array<string> = [];

    const connector = new MachineConnector({
      machines: { local: 'host-a', hosts: { 'host-a': {} } },
      hubVersion: '9.9.9',
      localTransportFactory: {
        requestHandler: peer.factory.requestHandler,
        streamHandler: peer.factory.streamHandler,
        open: (request) => {
          opened.push(request.name);

          return peer.factory.open(request);
        },
      },
      bindIdentity: () => Promise.resolve('bound'),
    });

    await expect(
      connector.request('host-a', 'roots.list', { envelope: ENVELOPE }),
    ).resolves.toEqual({ roots: [] });
    expect(opened).toEqual(['host-a']);
    expect(peer.sessions).toHaveLength(1);
  });

  it('refuses a non-local entry without a destination and spawns nothing', async () => {
    const opened: Array<string> = [];

    const connector = new MachineConnector({
      machines: {
        local: 'host-a',
        hosts: { 'host-a': {}, gpu: {} },
      },
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
      localTransportFactory: {
        open: (request) => {
          opened.push(request.name);

          throw new Error('no link should be opened');
        },
      },
    });

    const error = refusal(
      await connector
        .request('gpu', 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => rejection(error)),
    );

    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('This process cannot reach this Machine.');
    expect(opened).toEqual([]);
  });

  it('verifies the local Machine with the same identity bind as any other', async () => {
    const bindIdentity = vi.fn<
      NonNullable<MachineConnectorDeps['bindIdentity']>
    >(() => Promise.resolve('bound'));

    const connector = new MachineConnector({
      machines: { local: 'host-a', hosts: { 'host-a': {} } },
      hubVersion: '9.9.9',
      transportFactory: createProtocolPeer().factory,
      bindIdentity,
    });

    await expect(connector.verifyLocal()).resolves.toBeUndefined();
    expect(bindIdentity).toHaveBeenCalledWith(
      'host-a',
      DEFAULT_PEER_INSTANCE_ID,
    );
    expect(connector.lastRefusal('host-a')).toBeUndefined();
  });

  it('fails verifyLocal for a daemon under another identity', async () => {
    const connector = new MachineConnector({
      machines: { local: 'host-a', hosts: { 'host-a': {} } },
      hubVersion: '9.9.9',
      transportFactory: createProtocolPeer().factory,
      bindIdentity: () => Promise.resolve('mismatch'),
    });

    await expect(connector.verifyLocal()).rejects.toBeInstanceOf(
      MachineIdentityMismatchError,
    );
  });

  it('refuses verifyLocal when this process hosts no Machine', async () => {
    const connector = new MachineConnector({
      machines: { hosts: { devl: { destination: 'box' } } },
      hubVersion: '9.9.9',
      bindIdentity: () => Promise.resolve('match'),
    });

    const error = refusal(
      await connector.verifyLocal().catch((error: unknown) => rejection(error)),
    );

    expect(error.machine).toBe('machine');
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('No local Machine is configured.');
  });
});
