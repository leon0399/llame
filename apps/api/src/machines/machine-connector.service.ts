/**
 * MachineConnector — one session per Machine per worker process, opened on
 * first use and closed after five idle minutes, with the per-attempt
 * reachability cache and the per-Machine mutation chain (remote-machines
 * design D3). Everything a tool call needs about a Machine goes through here:
 * the tool layer never sees SSH, a transport, or a stream.
 *
 * Failure vocabulary, deliberately narrow:
 *
 * - a Machine's own JSON-RPC refusal (a bad budget, an unregistered path, a
 *   failed MCP start) travels as the protocol's `MachineProtocolError`;
 * - a session that could not be opened, or that was lost, is
 *   `MachineUnavailableError`, whose `sent` flag is the effect fence's whole
 *   input: `false` means nothing reached the Machine (`machine_unavailable`),
 *   `true` means the request had gone out and its outcome is unknown. A
 *   daemon answering under another computer's name is the one subclass,
 *   `MachineIdentityMismatchError`: never sent, and reported by name.
 */

import {
  PROTOCOL_VERSION,
  type HelloResult,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import type {
  MachineHostConfig,
  MachinesConfig,
} from '../instance-config/machines-config';

import type { BindOutcome } from './machine-bindings.repository';
import { createLocalChildTransportFactory } from './local-child-transport';
import {
  MachineIdentityMismatchError,
  MachineSession,
  MachineUnavailableError,
  type MachineChannelHandle,
  type MachineRequestOptions,
  type MachineSessionEnd,
} from './machine-session';
import {
  createMachineSshTransportFactory,
  type MachineSshTransportFactory,
  type MachineTransportFactory,
} from './machine-transport';
import {
  boundMachineRoots,
  boundMachineVersion,
  type MachineContact,
} from './machines-status';

/** How long a session with no open stream is kept before it is closed. */
export const MACHINE_IDLE_CLOSE_MS = 5 * 60_000;

/** Bound on the per-attempt reachability verdicts a process remembers. */
export const REACHABILITY_CACHE_LIMIT = 128;

export type MachineConnectorLogger = {
  error(message: string, trace?: string): void;
};

export type MachineConnectorDeps = {
  /** The resolved `machines` section; undefined means the feature is absent. */
  readonly machines: MachinesConfig | undefined;
  /** llame's own version, reported at each handshake. */
  readonly hubVersion: string;
  /** Test seam: how a session's link is opened. */
  readonly transportFactory?: MachineTransportFactory;
  /**
   * Test seam: the local Machine's link, when `transportFactory` is not given.
   * Production builds it from {@link createLocalChildTransportFactory}.
   */
  readonly localTransportFactory?: MachineTransportFactory;
  /** Where session events go (the `machines_status` writer). */
  readonly onContact?: (contact: MachineContact) => Promise<void> | void;
  /**
   * Binds this Machine name to the daemon's instance id, or compares it with
   * the stored one. Only `bound` and `match` admit the session to serve; any
   * other outcome, and a rejection, fails it closed.
   */
  readonly bindIdentity: (
    name: string,
    instanceId: string,
  ) => Promise<BindOutcome>;
  readonly logger?: MachineConnectorLogger;
  readonly now?: () => number;
  readonly idleCloseMs?: number;
  readonly handshakeTimeoutMs?: number;
};

type SessionEntry = {
  readonly session: MachineSession;
  idleTimer?: NodeJS.Timeout;
};

/**
 * The liveness part of one successful handshake's contact. Only a fresh
 * handshake adds `facts`, so a restamp never refreshes their capture time.
 */
function helloContact(hello: HelloResult): Omit<MachineContact, 'name' | 'at'> {
  return {
    hubProtocolVersion: PROTOCOL_VERSION,
    daemonProtocolVersion: hello.protocolVersion,
    daemonVersion: boundMachineVersion(hello.daemonVersion),
    roots: boundMachineRoots(hello.roots),
  };
}

export class MachineConnector {
  private readonly machines: MachinesConfig | undefined;
  private readonly hubVersion: string;
  private readonly onContact: MachineConnectorDeps['onContact'];
  private readonly bindIdentity: MachineConnectorDeps['bindIdentity'];
  private readonly logger: MachineConnectorLogger | undefined;
  private readonly now: () => number;
  private readonly idleCloseMs: number;
  private readonly handshakeTimeoutMs: number | undefined;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly opening = new Map<string, Promise<MachineSession>>();
  private readonly reachability = new Map<string, Promise<boolean>>();
  private readonly refusals = new Map<string, MachineUnavailableError>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly injected: MachineTransportFactory | undefined;
  private readonly injectedLocal: MachineTransportFactory | undefined;
  private ssh: MachineSshTransportFactory | undefined;
  private local: MachineTransportFactory | undefined;

  constructor(deps: MachineConnectorDeps) {
    this.machines = deps.machines;
    this.hubVersion = deps.hubVersion;
    this.onContact = deps.onContact;
    this.bindIdentity = deps.bindIdentity;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.idleCloseMs = deps.idleCloseMs ?? MACHINE_IDLE_CLOSE_MS;
    this.handshakeTimeoutMs = deps.handshakeTimeoutMs;
    this.injected = deps.transportFactory;
    this.injectedLocal = deps.localTransportFactory;
  }

  /** Whether Machines exist at all: an absent section means no Machine surface. */
  enabled(): boolean {
    return this.machines !== undefined;
  }

  /** Every configured Machine name, in configuration order. */
  names(): ReadonlyArray<string> {
    return Object.keys(this.hosts());
  }

  isConfigured(name: string): boolean {
    return Object.hasOwn(this.hosts(), name);
  }

  /** `machines.local`: the Machine this process hosts, served without SSH. */
  localMachine(): string | undefined {
    return this.machines?.local;
  }

  /** `machines.default`: the Machine an unbound Chat's tool calls address. */
  defaultMachine(): string | undefined {
    return this.machines?.default;
  }

  /**
   * Whether this process can reach the Machine at all: its own Machine needs
   * no link, and every other one needs an SSH destination.
   */
  canReach(name: string): boolean {
    return (
      name === this.localMachine() ||
      this.hosts()[name]?.destination !== undefined
    );
  }

  /**
   * Open (or reuse) the identity-checked session to `machines.local`. Every
   * in-process host operation calls this first: the host runs tool code inside
   * this process, so the daemon behind its Machine must be alive and bound to
   * the same instance id a remote one would have to be.
   */
  async verifyLocal(): Promise<void> {
    const name = this.localMachine();

    if (name === undefined)
      throw new MachineUnavailableError(
        'machine',
        'unreachable',
        false,
        'No local Machine is configured.',
      );

    await this.session(name);
    // A successful open is the most recent outcome: `lastRefusal` must not
    // keep answering for a refusal the Machine already recovered from.
    this.refusals.delete(name);
  }

  /**
   * Whether this Machine answered during this attempt. Decided once: the
   * verdict (either way) is cached for the attempt key, so preparation,
   * instructions, skills, and MCP do not each wait out a timeout, and a later
   * call in the same attempt does not re-open a hopeless session.
   */
  async reachable(name: string, attemptKey: string): Promise<boolean> {
    if (!this.enabled() || !this.isConfigured(name)) return false;
    const key = `${name}\u0000${attemptKey}`;
    const cached = this.reachability.get(key);

    if (cached !== undefined) return cached;
    const verdict = this.probe(name);
    this.remember(key, verdict);

    return verdict;
  }

  /**
   * The error this Machine's most recent open ended with, if it did. Callers
   * that only saw {@link reachable}'s boolean read it here when the refusal
   * itself carries the answer: a mismatched identity is a distinct tool result,
   * not a plain unavailability.
   */
  lastRefusal(name: string): MachineUnavailableError | undefined {
    return this.refusals.get(name);
  }

  /** One request over the Machine's session; the answer is untrusted JSON. */
  async request<M extends MachineMethod>(
    name: string,
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions = {},
  ): Promise<JsonValue> {
    // A signal already aborted must not open a session for a call nobody wants.
    options.signal?.throwIfAborted();
    const session = await this.session(name);

    try {
      return await session.request({ method, params }, options);
    } finally {
      this.armIdle(name);
    }
  }

  /**
   * Open a stream that outlives its answer: the Workspace MCP channel. The
   * caller keeps the session alive by holding the channel, and the channel's
   * `onClose` fires exactly when the stream or the session ends.
   */
  async openChannel<M extends MachineMethod>(
    name: string,
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions = {},
  ): Promise<MachineChannelHandle> {
    options.signal?.throwIfAborted();
    const session = await this.session(name);
    const handle = session.openChannel({ method, params }, options);
    handle.channel.onClose(() => this.armIdle(name));

    return handle;
  }

  /**
   * Run `operation` after every earlier Machine mutation finished, for this
   * Machine only: a slow Machine must never block local or Knowledge writes
   * the way the worker-wide chain would.
   */
  serializeMutation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(name) ?? Promise.resolve();
    const next = previous.then(() => operation());
    this.mutations.set(
      name,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );

    return next;
  }

  /** Close every session and remove the generated SSH configuration. */
  onModuleDestroy(): void {
    for (const entry of this.sessions.values()) {
      clearTimeout(entry.idleTimer);
      entry.session.close();
    }

    this.sessions.clear();
    this.ssh?.dispose();
    this.ssh = undefined;
  }

  private hosts(): Record<string, MachineHostConfig> {
    return this.machines?.hosts ?? {};
  }

  private async probe(name: string): Promise<boolean> {
    // A fresh handshake records its own contact; an ALREADY-OPEN session needs
    // its liveness re-stamped, or a long-lived session (a busy Workspace MCP
    // channel) would let a reachable Machine read offline once its last
    // handshake left the inactivity window.
    const wasReady = this.sessions.get(name)?.session.isReady === true;

    try {
      const session = await this.session(name);

      this.refusals.delete(name);

      if (wasReady) this.restampContact(name, session);

      return true;
    } catch (error) {
      // Reachability is a yes/no question to the caller; the refusal itself is
      // what `lastRefusal` answers, because a boolean loses the one reason the
      // tool vocabulary has to name.
      if (error instanceof MachineUnavailableError)
        this.refusals.set(name, error);

      return false;
    }
  }

  private restampContact(name: string, session: MachineSession): void {
    const hello = session.hello;

    if (hello === undefined) return;
    this.recordContact(name, helloContact(hello));
  }

  private remember(key: string, verdict: Promise<boolean>): void {
    this.reachability.set(key, verdict);

    while (this.reachability.size > REACHABILITY_CACHE_LIMIT) {
      const oldest = this.reachability.keys().next().value;

      if (oldest === undefined) return;
      this.reachability.delete(oldest);
    }
  }

  /** The Machine's live session, opening one when it has none. */
  private async session(name: string): Promise<MachineSession> {
    if (!this.enabled() || !this.isConfigured(name))
      throw new MachineUnavailableError(
        name,
        'unreachable',
        false,
        'This Machine is not configured.',
      );
    // A pending open is awaited by every caller: its session became ready at
    // the handshake, before the identity bind resolved, so it must never be
    // handed out while it is still in `opening`. A pending open and a ready
    // session cannot coexist.
    const opening = this.opening.get(name);

    if (opening !== undefined) return opening;
    const existing = this.sessions.get(name);

    if (existing !== undefined && existing.session.isReady)
      return existing.session;

    const started = this.startSession(name).finally(() =>
      this.opening.delete(name),
    );

    this.opening.set(name, started);

    return started;
  }

  private async startSession(name: string): Promise<MachineSession> {
    const local = name === this.localMachine();
    const destination = this.hosts()[name]?.destination;

    // The local Machine is a child of this process and needs no destination;
    // every other Machine is only reachable through SSH.
    if (!local && destination === undefined)
      throw new MachineUnavailableError(
        name,
        'unreachable',
        false,
        'This process cannot reach this Machine.',
      );

    const session = new MachineSession({
      name,
      transport: this.factory(name).open({ name, destination }),
      hubVersion: this.hubVersion,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
    });

    this.sessions.set(name, { session });
    void session.ended.then((end) => this.onEnded(name, session, end));
    const hello = await session.ready();

    // The bind decides whether this session may ever carry a request. It runs
    // after the handshake and before anything else: a daemon answering under
    // another computer's name never sees a request, and a bind that cannot be
    // read fails the session closed instead of trusting the daemon.
    await this.verifyIdentity(name, session, hello.instanceId);

    this.recordContact(name, { ...helloContact(hello), facts: hello.facts });
    this.armIdle(name);

    return session;
  }

  /**
   * Bind or compare this handshake's instance id, and admit the session to
   * serve requests only when it matches (or nothing is bound yet). The session
   * is closed first on every refusal, so no request can slip through while the
   * caller unwinds.
   */
  private async verifyIdentity(
    name: string,
    session: MachineSession,
    instanceId: string,
  ): Promise<void> {
    const outcome = await this.bindIdentity(name, instanceId).catch(
      (error: unknown) => {
        this.logger?.error(
          `Checking the identity binding of Machine ${name} failed`,
          error instanceof Error ? error.stack : String(error),
        );
        session.close();
        // No contact: the daemon did nothing wrong, and an outage of the hub's
        // own database says nothing about the Machine.
        throw new MachineUnavailableError(
          name,
          'session_lost',
          false,
          'The identity binding of this Machine could not be checked.',
        );
      },
    );

    // Only an explicit admission serves: anything else, including an outcome
    // this hub does not know, fails the session closed.
    if (outcome === 'bound' || outcome === 'match') return;

    session.close();
    this.recordContact(name, {
      hubProtocolVersion: PROTOCOL_VERSION,
      failure: 'identity_mismatch',
    });
    throw new MachineIdentityMismatchError(name);
  }

  private onEnded(
    name: string,
    session: MachineSession,
    end: MachineSessionEnd,
  ): void {
    const entry = this.sessions.get(name);

    if (entry?.session === session) {
      clearTimeout(entry.idleTimer);
      this.sessions.delete(name);
    }

    // A clean close is llame's own doing, not a failure to report.
    if (end.reason === 'closed') return;
    this.recordContact(name, {
      hubProtocolVersion: PROTOCOL_VERSION,
      failure: end.reason,
    });
  }

  private recordContact(
    name: string,
    contact: Omit<MachineContact, 'name' | 'at'>,
  ): void {
    const sink = this.onContact;

    if (sink === undefined) return;
    void this.writeContact(sink, {
      name,
      at: new Date(this.now()),
      ...contact,
    });
  }

  private async writeContact(
    sink: NonNullable<MachineConnectorDeps['onContact']>,
    contact: MachineContact,
  ): Promise<void> {
    try {
      await sink(contact);
    } catch (error) {
      this.logger?.error(
        `Recording the contact with Machine ${contact.name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private armIdle(name: string): void {
    const entry = this.sessions.get(name);

    if (entry === undefined) return;

    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }

    if (!entry.session.isReady || entry.session.openStreams > 0) return;
    const timer = setTimeout(() => this.idleOut(name, entry), this.idleCloseMs);
    timer.unref();
    entry.idleTimer = timer;
  }

  private idleOut(name: string, entry: SessionEntry): void {
    entry.idleTimer = undefined;

    if (this.sessions.get(name) !== entry) return;

    // A stream may have opened while the idle timer was armed.
    if (entry.session.openStreams > 0) return;
    // A polite close, not a failure: the Machine reports nothing wrong.
    entry.session.close();
  }

  private factory(name: string): MachineTransportFactory {
    if (this.injected !== undefined) return this.injected;

    // The local Machine is a child process of this hub, never SSH: the same
    // session, protocol, and identity bind, with a pipe where ssh would be.
    if (name === this.localMachine())
      return (this.local ??=
        this.injectedLocal ?? createLocalChildTransportFactory());
    const ssh = this.machines?.ssh;

    if (ssh === undefined)
      throw new MachineUnavailableError(
        'machine',
        'unreachable',
        false,
        'No Machine SSH settings are configured.',
      );
    this.ssh ??= createMachineSshTransportFactory({ ssh });

    return this.ssh;
  }
}

export { MachineUnavailableError } from './machine-session';
