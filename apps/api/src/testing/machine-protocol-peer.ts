import { PassThrough } from 'node:stream';

import {
  MachineProtocolError,
  PROTOCOL_VERSION,
  type HelloResult,
  type JsonValue,
  type MachineErrorCode,
  type MachineFacts,
} from '@workspace/machine-protocol';

import type {
  MachineRequestOptions,
  MachineStreamInvocation,
} from '../machines/machine-session';
import type {
  MachineLinkEnd,
  MachineTransport,
  MachineTransportFactory,
} from '../machines/machine-transport';

export type PeerCall = { readonly method: string; readonly params?: JsonValue };
export type PeerAnswer =
  | { readonly value: JsonValue }
  | { readonly error: MachineErrorCode }
  | { readonly hold: true };
export type ProtocolPeerOptions = {
  readonly roots?: ReadonlyArray<string>;
  readonly daemonVersion?: string;
  readonly instanceId?: string;
  readonly buildId?: string;
  readonly facts?: MachineFacts;
  readonly helloProtocolVersion?: number;
  readonly methods?: ReadonlyArray<string>;
  readonly silentHello?: boolean;
  readonly answers?: Readonly<Record<string, PeerAnswer>>;
  readonly answer?: (
    call: PeerCall,
  ) => PeerAnswer | Promise<PeerAnswer | undefined> | undefined;
  readonly onNotification?: (
    method: string,
    notification: { readonly method: string; readonly params?: JsonValue },
  ) => void;
  readonly openFailure?: () => string | undefined;
};
export type PeerSession = {
  readonly requests: ReadonlyArray<string>;
  readonly calls: ReadonlyArray<PeerCall>;
  readonly openStreams: number;
  readonly maxOpenStreams: number;
  readonly stopped: boolean;
  release(method: string, value: JsonValue, keepOpen?: boolean): void;
  notify(method: string, notification: string, params?: JsonValue): void;
  drop(options?: {
    readonly code?: number | null;
    readonly diagnostic?: string;
  }): void;
  stopHeartbeat(): void;
  awaitRequests(count: number): Promise<void>;
  awaitStop(): Promise<void>;
};
export type ProtocolPeer = {
  readonly factory: MachineTransportFactory;
  readonly sessions: ReadonlyArray<PeerSession>;
  session(index: number): Promise<PeerSession>;
};

const DEFAULT_ANSWER: PeerAnswer = { error: 'internal' };
export const DEFAULT_PEER_INSTANCE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_PEER_BUILD_ID = '0123456789ab';

export function defaultPeerFacts(roots: ReadonlyArray<string>): MachineFacts {
  return {
    os: 'linux',
    arch: 'x64',
    kernel: '6.8.0',
    cpuCount: 8,
    totalMemoryBytes: 16 * 1024 ** 3,
    rootDisks: roots.map((root) => ({ root, totalBytes: 512 * 1024 ** 3 })),
  };
}
export function wireJson<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

type Pending = { resolve(value: JsonValue): void; reject(error: Error): void };
class PeerSessionImpl implements PeerSession {
  readonly requests: Array<string> = [];
  readonly calls: Array<PeerCall> = [];
  private readonly pending = new Map<string, Array<Pending>>();
  private readonly requestWaiters: Array<{ count: number; resolve(): void }> =
    [];
  private readonly notifications = new Map<
    string,
    (method: string, params?: JsonValue) => void
  >();
  private readonly stopSignal = Promise.withResolvers<void>();
  private readonly endSignal = Promise.withResolvers<MachineLinkEnd>();
  private activeStreams = 0;
  private highWater = 0;
  private halted = false;
  readonly transport: MachineTransport;

  constructor(
    private readonly options: ProtocolPeerOptions,
    failure?: string,
  ) {
    const input = new PassThrough();
    const output = new PassThrough();
    this.transport = {
      input,
      output,
      close: () => this.terminate(true),
      ended: this.endSignal.promise,
    };
    if (failure !== undefined) this.drop({ diagnostic: failure });
  }
  get openStreams(): number {
    return this.activeStreams;
  }
  get maxOpenStreams(): number {
    return this.highWater;
  }
  get stopped(): boolean {
    return this.halted;
  }

  async request(
    method: string,
    params: JsonValue,
    options: MachineRequestOptions,
  ): Promise<JsonValue> {
    if (this.halted) throw new Error('peer session stopped');
    if (method === 'hello') {
      if (this.options.silentHello) {
        const { promise, reject } = Promise.withResolvers<JsonValue>();
        options.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason),
          { once: true },
        );
        return promise;
      }
      const roots = this.options.roots ?? ['/srv/app'];
      const hello: HelloResult = {
        protocolVersion: this.options.helloProtocolVersion ?? PROTOCOL_VERSION,
        daemonVersion: this.options.daemonVersion ?? '0.0.1',
        roots,
        ...(this.options.methods === undefined
          ? {}
          : { methods: this.options.methods }),
        instanceId: this.options.instanceId ?? DEFAULT_PEER_INSTANCE_ID,
        buildId: this.options.buildId ?? DEFAULT_PEER_BUILD_ID,
        facts: this.options.facts ?? defaultPeerFacts(roots),
      };
      return wireJson(hello);
    }
    this.requests.push(method);
    this.calls.push({ method, params });
    for (const waiter of [...this.requestWaiters]) {
      if (this.requests.length >= waiter.count) {
        this.requestWaiters.splice(this.requestWaiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
    const call = { method, params };
    const override = await this.options.answer?.(call);
    const answer =
      override ??
      this.options.answers?.[method] ??
      (method === 'roots.list'
        ? { value: wireJson({ roots: this.options.roots ?? ['/srv/app'] }) }
        : DEFAULT_ANSWER);
    if ('error' in answer)
      throw new MachineProtocolError(
        answer.error,
        `The Machine refused ${method}.`,
      );
    if ('hold' in answer) {
      const { promise, resolve, reject } = Promise.withResolvers<JsonValue>();
      const waiting = this.pending.get(method) ?? [];
      waiting.push({ resolve, reject });
      this.pending.set(method, waiting);
      return promise;
    }
    return answer.value;
  }

  async stream(invocation: MachineStreamInvocation): Promise<JsonValue> {
    const { method, params, notify, options } = invocation;
    this.activeStreams += 1;
    this.highWater = Math.max(this.highWater, this.activeStreams);
    this.notifications.set(method, (notificationMethod, notificationParams) =>
      notify({
        method: notificationMethod,
        ...(notificationParams === undefined
          ? {}
          : { params: notificationParams }),
      }),
    );
    const abortListener = () => this.notifications.delete(method);
    options.signal?.addEventListener('abort', abortListener, { once: true });
    try {
      return await this.request(method, params, options);
    } finally {
      this.activeStreams -= 1;
      this.notifications.delete(method);
      options.signal?.removeEventListener('abort', abortListener);
    }
  }

  release(method: string, value: JsonValue, _keepOpen = false): void {
    const waiting = this.pending.get(method);
    const pending = waiting?.shift();
    if (waiting?.length === 0) this.pending.delete(method);
    pending?.resolve(value);
  }
  notify(method: string, notification: string, params?: JsonValue): void {
    this.notifications.get(method)?.(notification, params);
  }
  drop(
    options: {
      readonly code?: number | null;
      readonly diagnostic?: string;
    } = {},
  ): void {
    this.terminate(false, options);
  }
  stopHeartbeat(): void {}
  awaitRequests(count: number): Promise<void> {
    if (this.requests.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.requestWaiters.push({ count, resolve });
    return promise;
  }
  awaitStop(): Promise<void> {
    return this.stopSignal.promise;
  }

  private terminate(
    closedByHub: boolean,
    options: {
      readonly code?: number | null;
      readonly diagnostic?: string;
    } = {},
  ): void {
    if (this.halted) return;
    this.halted = true;
    for (const waiting of this.pending.values())
      waiting.forEach(({ reject }) =>
        reject(new Error(options.diagnostic ?? 'peer session stopped')),
      );
    this.pending.clear();
    this.stopSignal.resolve();
    this.endSignal.resolve({
      code: closedByHub ? null : (options.code ?? 255),
      signal: null,
      diagnostic: options.diagnostic ?? '',
      closedByHub,
    });
  }
}

export function createProtocolPeer(
  options: ProtocolPeerOptions = {},
): ProtocolPeer {
  const sessions: Array<PeerSessionImpl> = [];
  const waiters: Array<() => void> = [];
  let current: PeerSessionImpl | undefined;
  const factory: MachineTransportFactory = {
    requestHandler: (method, params, requestOptions) =>
      current === undefined
        ? Promise.reject(new Error('the peer has no session'))
        : current.request(method, params, requestOptions),
    streamHandler: (invocation) =>
      current === undefined
        ? Promise.reject(new Error('the peer has no session'))
        : current.stream(invocation),
    open: () => {
      const session = new PeerSessionImpl(options, options.openFailure?.());
      sessions.push(session);
      current = session;
      waiters.splice(0).forEach((wake) => wake());
      return session.transport;
    },
  };
  return {
    factory,
    sessions,
    async session(index: number) {
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
}
