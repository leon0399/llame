/**
 * An in-process daemon side for hub tests: framing, stream multiplexing, the
 * hello handshake, heartbeats, and scriptable answers over real pipes. The
 * api test projects build nothing from `apps/machine`, so a hub test that
 * wanted the real daemon would need the bundle (absent in CI) or SSH (absent
 * everywhere) — this peer keeps the wire real while the Machine's own
 * behaviour stays the daemon suite's concern.
 *
 * Deliberately under `src/testing/`: it is scaffolding, excluded from coverage
 * and from mutation (apps/api/stryker.config.json), and never imported by
 * production code.
 */

import { PassThrough } from 'node:stream';

import {
  createFrameMultiplexer,
  createHeartbeat,
  createLineFramer,
  CONTROL_STREAM_ID,
  decodeFrame,
  encodeFrame,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISSES,
  PING_NOTIFICATION,
  PROTOCOL_VERSION,
  type Frame,
  type FrameMultiplexer,
  type Heartbeat,
  type JsonRpcNotification,
  type JsonValue,
  type MachineChannel,
  type MachineErrorCode,
} from '@workspace/machine-protocol';

import type {
  MachineLinkEnd,
  MachineTransport,
  MachineTransportFactory,
} from '../machines/machine-transport';

/** One request the peer received, with the params its caller actually sent. */
export type PeerCall = {
  readonly method: string;
  readonly params?: JsonValue;
};

/** What the peer answers one method with. */
export type PeerAnswer =
  | { readonly value: JsonValue }
  | { readonly error: MachineErrorCode }
  /** Answer later, by name, through `release`. */
  | { readonly hold: true };

export type ProtocolPeerOptions = {
  readonly roots?: ReadonlyArray<string>;
  readonly daemonVersion?: string;
  /** Override the version the daemon claims, to test a handshake refusal. */
  readonly helloProtocolVersion?: number;
  /** Never answer the handshake at all. */
  readonly silentHello?: boolean;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatMisses?: number;
  readonly answers?: Readonly<Record<string, PeerAnswer>>;
  /**
   * Answer one request from the request itself, taking precedence over
   * `answers`. This is what a walk needs: the same method (`fs.stat`, `fs.list`)
   * answers differently for each path, and `undefined` falls back to `answers`.
   */
  readonly answer?: (call: PeerCall) => PeerAnswer | undefined;
  /**
   * Observes the notifications the HUB sends on a request stream (for example
   * `mcp.message` and `mcp.setProtocolVersion`), keyed by the method whose
   * stream carries them. Purely additive: omitted, the peer behaves as before.
   */
  readonly onNotification?: (
    method: string,
    notification: JsonRpcNotification,
  ) => void;
  /**
   * When it returns a diagnostic, every `open` yields a link that failed the
   * way ssh would: an unreachable Machine. Returning undefined again makes the
   * Machine reachable, which is how one connector's per-attempt cache is
   * exercised across connectivity flips.
   */
  readonly openFailure?: () => string | undefined;
};

export type PeerSession = {
  /** Request method names, in arrival order. */
  readonly requests: ReadonlyArray<string>;
  /** Every request in arrival order, with the params it carried. */
  readonly calls: ReadonlyArray<PeerCall>;
  /** Hub streams this peer has open right now. */
  readonly openStreams: number;
  /** The most hub streams this peer ever carried at once. */
  readonly maxOpenStreams: number;
  /** Answer the oldest held request of `method`, closing its stream. */
  release(method: string, value: JsonValue, keepOpen?: boolean): void;
  /** Send a notification on the newest stream that carried `method`. */
  notify(method: string, notification: string, params?: JsonValue): void;
  /** End the peer's side abruptly, as a lost link, with ssh-like stderr. */
  drop(options?: {
    readonly code?: number | null;
    readonly diagnostic?: string;
  }): void;
  /** Stop pinging, so the hub's own liveness check ends the session. */
  stopHeartbeat(): void;
  /** Waits until this peer has received `count` requests. */
  awaitRequests(count: number): Promise<void>;
  /** Waits until this peer's side has stopped. */
  awaitStop(): Promise<void>;
  /** Whether the peer's side has stopped. */
  readonly stopped: boolean;
};

export type ProtocolPeer = {
  /** The factory a connector is constructed with. */
  readonly factory: MachineTransportFactory;
  /** One entry per session the hub opened, oldest first. */
  readonly sessions: ReadonlyArray<PeerSession>;
  /** The session the hub opened at `index`, waited for if it is not open yet. */
  session(index: number): Promise<PeerSession>;
};

const DEFAULT_ANSWER: PeerAnswer = { error: 'internal' };

/** One peer-side session: its own multiplexer, framer, and heartbeat. */
class PeerSessionImpl implements PeerSession {
  readonly requests: Array<string> = [];
  readonly calls: Array<PeerCall> = [];
  readonly transport: MachineTransport;
  private readonly toHub = new PassThrough();
  private readonly fromHub = new PassThrough();
  private readonly multiplexer: FrameMultiplexer;
  private readonly framer = createLineFramer();
  private readonly heartbeat: Heartbeat;
  private readonly end = Promise.withResolvers<MachineLinkEnd>();
  private readonly held: Array<{ method: string; channel: MachineChannel }> =
    [];
  private readonly streamByMethod = new Map<string, MachineChannel>();
  private readonly requestWaiters: Array<{
    readonly count: number;
    readonly resolve: () => void;
  }> = [];
  private readonly stopSignal = Promise.withResolvers<void>();
  private highWater = 0;
  private halted = false;

  constructor(private readonly options: ProtocolPeerOptions) {
    this.transport = {
      input: this.toHub,
      output: this.fromHub,
      close: () => this.terminate(),
      ended: this.end.promise,
    };
    this.multiplexer = createFrameMultiplexer({
      send: (frame) => this.write(frame),
      onRequest: (channel, request) => this.handle(channel, request),
    });
    this.heartbeat = createHeartbeat({
      intervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      misses: options.heartbeatMisses ?? HEARTBEAT_MISSES,
      sendPing: () => this.multiplexer.control.notify(PING_NOTIFICATION),
      onLost: () => this.terminate(),
    });
    this.fromHub.on('data', (chunk: Buffer) => this.receive(chunk));
    this.fromHub.on('end', () => this.terminate());
    this.fromHub.on('error', () => this.terminate());
    this.toHub.on('error', () => this.terminate());
    this.heartbeat.start();
  }

  get stopped(): boolean {
    return this.halted;
  }

  get openStreams(): number {
    return this.halted ? 0 : this.multiplexer.openStreams;
  }

  get maxOpenStreams(): number {
    return Math.max(this.highWater, this.openStreams);
  }

  awaitRequests(count: number): Promise<void> {
    if (this.requests.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.requestWaiters.push({ count, resolve });
    return promise;
  }

  awaitStop(): Promise<void> {
    return this.stopSignal.promise;
  }

  release(method: string, value: JsonValue, keepOpen = false): void {
    const index = this.held.findIndex((entry) => entry.method === method);
    const entry = this.held[index];
    if (entry === undefined)
      throw new Error(`The peer holds no ${method} request.`);
    this.held.splice(index, 1);
    entry.channel.result(value);
    if (!keepOpen) entry.channel.close();
  }

  notify(method: string, notification: string, params?: JsonValue): void {
    const channel = this.streamByMethod.get(method);
    if (channel === undefined)
      throw new Error(`The peer saw no ${method} stream.`);
    channel.notify(notification, params);
  }

  drop(
    options: {
      readonly code?: number | null;
      readonly diagnostic?: string;
    } = {},
  ): void {
    this.end.resolve({
      code: options.code === undefined ? 255 : options.code,
      signal: null,
      diagnostic: options.diagnostic ?? 'ssh: connection closed by remote host',
      closedByHub: false,
    });
    this.stopPipes();
  }

  stopHeartbeat(): void {
    this.heartbeat.stop();
  }

  /** The hub closed the link: an idle close or a shutdown. */
  private terminate(): void {
    this.end.resolve({
      code: null,
      signal: null,
      diagnostic: 'closed by hub',
      closedByHub: true,
    });
    this.stopPipes();
  }

  private stopPipes(): void {
    if (this.halted) return;
    this.halted = true;
    this.heartbeat.stop();
    this.multiplexer.close();
    this.toHub.end();
    this.fromHub.destroy();
    this.stopSignal.resolve();
  }

  private write(frame: Frame): void {
    if (this.halted) return;
    this.toHub.write(encodeFrame(frame));
  }

  /** Wake every waiter whose request count is now satisfied. */
  private notifyRequests(): void {
    for (let index = this.requestWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.requestWaiters[index];
      if (waiter === undefined || this.requests.length < waiter.count) continue;
      this.requestWaiters.splice(index, 1);
      waiter.resolve();
    }
  }

  private receive(chunk: Buffer): void {
    this.heartbeat.record();
    for (const event of this.framer.push(chunk)) {
      if (event.kind !== 'line') continue;
      const decoded = decodeFrame(event.line);
      if (decoded.ok) this.multiplexer.handle(decoded.frame);
    }
  }

  private handle(
    channel: MachineChannel,
    request: { method: string; params?: JsonValue },
  ): void {
    if (channel.id === CONTROL_STREAM_ID) {
      this.handleHello(channel);
      return;
    }
    const answer =
      this.options.answer?.(request) ??
      this.options.answers?.[request.method] ??
      DEFAULT_ANSWER;
    this.requests.push(request.method);
    this.calls.push({ method: request.method, params: request.params });
    // Registered on the method's own stream, before the hub can send anything
    // after its request: `onRequest` runs as the request frame is decoded.
    channel.onNotification((notification) => {
      this.options.onNotification?.(request.method, notification);
    });
    this.notifyRequests();
    this.streamByMethod.set(request.method, channel);
    this.highWater = Math.max(this.highWater, this.multiplexer.openStreams);
    if ('hold' in answer) {
      this.held.push({ method: request.method, channel });
      return;
    }
    if ('error' in answer) {
      channel.error(answer.error, `the peer refused ${request.method}`);
    } else {
      channel.result(answer.value);
    }
    channel.close();
  }

  private handleHello(channel: MachineChannel): void {
    if (this.options.silentHello === true) return;
    const version = this.options.helloProtocolVersion ?? PROTOCOL_VERSION;
    if (version !== PROTOCOL_VERSION) {
      channel.error('incompatible_version', 'version mismatch', {
        hubProtocolVersion: PROTOCOL_VERSION,
        daemonProtocolVersion: version,
      });
      return;
    }
    channel.result({
      protocolVersion: version,
      daemonVersion: this.options.daemonVersion ?? '0.0.1',
      roots: [...(this.options.roots ?? [])],
    });
  }
}

/**
 * A peer factory: every `open` is one fresh session, exactly as an SSH
 * connection per session is in production.
 */
export function createProtocolPeer(
  options: ProtocolPeerOptions = {},
): ProtocolPeer {
  const sessions: Array<PeerSession> = [];
  const waiters: Array<() => void> = [];
  const peer: ProtocolPeer = {
    sessions,
    factory: {
      open: () => {
        const failure = options.openFailure?.();
        if (failure !== undefined) return createFailedTransport(failure);
        const session = new PeerSessionImpl(options);
        sessions.push(session);
        for (const resolve of waiters.splice(0)) resolve();
        return session.transport;
      },
    },
    session: async (index: number) => {
      while (sessions.length <= index) {
        const { promise, resolve } = Promise.withResolvers<void>();
        waiters.push(resolve);
        await promise;
      }
      const session = sessions[index];
      if (session === undefined)
        throw new Error('the peer has no such session');
      return session;
    },
  };
  return peer;
}

/** A link that failed the way ssh reports an unreachable Machine. */
function createFailedTransport(diagnostic: string): MachineTransport {
  const input = new PassThrough();
  const output = new PassThrough();
  // The session attaches its listeners before the link can announce its end,
  // so the refused connection is observed exactly as a real ssh failure is.
  setTimeout(() => input.destroy(), 0);
  return {
    input,
    output,
    close: () => input.destroy(),
    ended: Promise.resolve({
      code: 255,
      signal: null,
      diagnostic,
      closedByHub: false,
    }),
  };
}
