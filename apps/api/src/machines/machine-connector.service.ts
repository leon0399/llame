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
 *   `true` means the request had gone out and its outcome is unknown.
 */

import {
  PROTOCOL_VERSION,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import type { MachinesConfig } from '../instance-config/machines-config';

import {
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
  /** Where session events go (the `machines_status` writer). */
  readonly onContact?: (contact: MachineContact) => Promise<void> | void;
  readonly logger?: MachineConnectorLogger;
  readonly now?: () => number;
  readonly idleCloseMs?: number;
  readonly handshakeTimeoutMs?: number;
};

type SessionEntry = {
  readonly session: MachineSession;
  idleTimer?: NodeJS.Timeout;
};

export class MachineConnector {
  private readonly machines: MachinesConfig | undefined;
  private readonly hubVersion: string;
  private readonly onContact: MachineConnectorDeps['onContact'];
  private readonly logger: MachineConnectorLogger | undefined;
  private readonly now: () => number;
  private readonly idleCloseMs: number;
  private readonly handshakeTimeoutMs: number | undefined;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly opening = new Map<string, Promise<MachineSession>>();
  private readonly reachability = new Map<string, Promise<boolean>>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly injected: MachineTransportFactory | undefined;
  private ssh: MachineSshTransportFactory | undefined;

  constructor(deps: MachineConnectorDeps) {
    this.machines = deps.machines;
    this.hubVersion = deps.hubVersion;
    this.onContact = deps.onContact;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.idleCloseMs = deps.idleCloseMs ?? MACHINE_IDLE_CLOSE_MS;
    this.handshakeTimeoutMs = deps.handshakeTimeoutMs;
    this.injected = deps.transportFactory;
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

  private hosts(): Record<string, { readonly destination: string }> {
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
      if (wasReady) this.restampContact(name, session);
      return true;
    } catch {
      // Reachability is a yes/no question to the caller; why it failed is the
      // session's contact event, which the status writer already sees.
      return false;
    }
  }

  private restampContact(name: string, session: MachineSession): void {
    const hello = session.hello;
    if (hello === undefined) return;
    this.recordContact(name, {
      hubProtocolVersion: PROTOCOL_VERSION,
      daemonProtocolVersion: hello.protocolVersion,
      daemonVersion: boundMachineVersion(hello.daemonVersion),
      roots: boundMachineRoots(hello.roots),
    });
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
    const existing = this.sessions.get(name);
    if (existing !== undefined && existing.session.isReady)
      return existing.session;
    const opening = this.opening.get(name);
    if (opening !== undefined) return opening;
    const started = this.startSession(name).finally(() =>
      this.opening.delete(name),
    );
    this.opening.set(name, started);
    return started;
  }

  private async startSession(name: string): Promise<MachineSession> {
    const destination = this.hosts()[name]?.destination;
    if (destination === undefined)
      throw new MachineUnavailableError(
        name,
        'unreachable',
        false,
        'This Machine is not configured.',
      );
    const session = new MachineSession({
      name,
      transport: this.factory().open({ name, destination }),
      hubVersion: this.hubVersion,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
    });
    this.sessions.set(name, { session });
    void session.ended.then((end) => this.onEnded(name, session, end));
    const hello = await session.ready();
    this.recordContact(name, {
      hubProtocolVersion: PROTOCOL_VERSION,
      daemonProtocolVersion: hello.protocolVersion,
      daemonVersion: boundMachineVersion(hello.daemonVersion),
      roots: boundMachineRoots(hello.roots),
    });
    this.armIdle(name);
    return session;
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

  private factory(): MachineTransportFactory {
    if (this.injected !== undefined) return this.injected;
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
