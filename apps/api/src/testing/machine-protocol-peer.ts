import { Code, ConnectError } from '@connectrpc/connect';

import { z } from 'zod';

import { PassThrough } from 'node:stream';

import {
  MachineProtocolError,
  PROTOCOL_VERSION,
  type HelloResult,
  type JsonValue,
  type MachineErrorCode,
  type MachineFacts,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import type {
  MachineRequestHandler,
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
  | { readonly hold: true }
  | { readonly unimplemented: true };

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
    options: MachineRequestOptions,
    notify: (notification: {
      readonly method: string;
      readonly params?: JsonValue;
    }) => void,
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

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export function wireJson<T>(value: T): JsonValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined)
    throw new TypeError('Value cannot be serialized as JSON.');

  return jsonValueSchema.parse(JSON.parse(serialized));
}

type Pending = { resolve(value: JsonValue): void; reject(error: Error): void };

function peerHello(
  options: ProtocolPeerOptions,
  requestOptions: MachineRequestOptions,
): Promise<JsonValue> | JsonValue {
  if (options.silentHello) {
    const { promise, reject } = Promise.withResolvers<JsonValue>();

    requestOptions.signal?.addEventListener(
      'abort',
      () => reject(requestOptions.signal?.reason),
      { once: true },
    );

    return promise;
  }

  const roots = options.roots ?? ['/srv/app'];

  const hello: HelloResult = {
    protocolVersion: options.helloProtocolVersion ?? PROTOCOL_VERSION,
    daemonVersion: options.daemonVersion ?? '0.0.1',
    roots,
    instanceId: options.instanceId ?? DEFAULT_PEER_INSTANCE_ID,
    buildId: options.buildId ?? DEFAULT_PEER_BUILD_ID,
    facts: options.facts ?? defaultPeerFacts(roots),
  };

  return wireJson(hello);
}

async function answerCall(
  peerOptions: ProtocolPeerOptions,
  call: PeerCall,
  requestOptions: MachineRequestOptions,
  notify: (notification: {
    readonly method: string;
    readonly params?: JsonValue;
  }) => void,
): Promise<PeerAnswer> {
  const override = await peerOptions.answer?.(call, requestOptions, notify);

  return (
    override ??
    peerOptions.answers?.[call.method] ??
    (call.method === 'roots.list'
      ? { value: wireJson({ roots: peerOptions.roots ?? ['/srv/app'] }) }
      : DEFAULT_ANSWER)
  );
}

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
  private readonly keepOpenNotifications = new Set<string>();
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

    if (method === 'hello') return peerHello(this.options, options);

    const call = { method, params };

    const answer = await answerCall(
      this.options,
      call,
      options,
      (notification) =>
        this.notifications.get(method)?.(
          notification.method,
          notification.params,
        ),
    );

    if (this.halted) throw new Error('peer session stopped');

    this.recordRequest(call);

    if ('unimplemented' in answer)
      throw new ConnectError(
        `The Machine does not implement ${method}.`,
        Code.Unimplemented,
      );

    if ('error' in answer)
      throw new MachineProtocolError(
        answer.error,
        `The Machine refused ${method}.`,
      );

    if ('hold' in answer) return this.hold(method, options);

    return answer.value;
  }

  private recordRequest(call: PeerCall): void {
    this.requests.push(call.method);
    this.calls.push(call);

    for (let index = this.requestWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.requestWaiters[index];

      if (waiter !== undefined && this.requests.length >= waiter.count) {
        this.requestWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  private hold(
    method: string,
    options: MachineRequestOptions,
  ): Promise<JsonValue> {
    const { promise, resolve, reject } = Promise.withResolvers<JsonValue>();
    const waiting = this.pending.get(method) ?? [];
    const abort = () => reject(new Error('Machine request was cancelled.'));

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });

    waiting.push({
      resolve: (value) => {
        options.signal?.removeEventListener('abort', abort);
        resolve(value);
      },
      reject: (error) => {
        options.signal?.removeEventListener('abort', abort);
        reject(error);
      },
    });
    this.pending.set(method, waiting);

    return promise;
  }

  async stream(invocation: MachineStreamInvocation): Promise<JsonValue> {
    const { method, params, notify, options } = invocation;
    this.activeStreams += 1;
    this.highWater = Math.max(this.highWater, this.activeStreams);
    this.notifications.set(method, (notificationMethod, notificationParams) => {
      if (notificationParams === undefined)
        notify({ method: notificationMethod });
      else notify({ method: notificationMethod, params: notificationParams });
    });

    const abortListener = () => {
      this.notifications.delete(method);
      this.keepOpenNotifications.delete(method);
    };

    options.signal?.addEventListener('abort', abortListener, { once: true });

    try {
      return await this.request(method, params, options);
    } finally {
      this.activeStreams -= 1;

      if (!this.keepOpenNotifications.delete(method))
        this.notifications.delete(method);

      options.signal?.removeEventListener('abort', abortListener);
    }
  }

  release(method: string, value: JsonValue, keepOpen = false): void {
    const waiting = this.pending.get(method);
    const pending = waiting?.shift();

    if (waiting?.length === 0) this.pending.delete(method);

    if (keepOpen) this.keepOpenNotifications.add(method);

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

    for (const waiting of this.pending.values()) {
      waiting.forEach((pending) =>
        pending.reject(
          new ConnectError(
            options.diagnostic ?? 'peer session stopped',
            Code.Unavailable,
          ),
        ),
      );
    }

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
  const requestHandler = createRequestHandler(() => current);

  const factory: MachineTransportFactory = {
    requestHandler,
    streamHandler: (invocation: MachineStreamInvocation) =>
      current === undefined
        ? Promise.reject(new Error('the peer has no session'))
        : current.stream(invocation),
    open: () => {
      current = openPeerSession(options, sessions, waiters);

      return current.transport;
    },
  };

  return {
    factory,
    sessions,
    session: (index) => peerSession(index, sessions, waiters),
  };
}

function createRequestHandler(
  current: () => PeerSessionImpl | undefined,
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
  async function handler(
    method: MachineMethod,
    params: JsonValue,
    options: MachineRequestOptions,
  ): Promise<JsonValue> {
    const session = current();

    if (session === undefined) throw new Error('the peer has no session');

    return session.request(method, params, options);
  }

  return handler;
}

function openPeerSession(
  options: ProtocolPeerOptions,
  sessions: Array<PeerSessionImpl>,
  waiters: Array<() => void>,
): PeerSessionImpl {
  const failure = options.openFailure?.();
  const session = new PeerSessionImpl(options, failure);

  sessions.push(session);
  waiters.splice(0).forEach((wake) => wake());

  return session;
}

async function peerSession(
  index: number,
  sessions: Array<PeerSessionImpl>,
  waiters: Array<() => void>,
): Promise<PeerSessionImpl> {
  while (sessions.length <= index) {
    const { promise, resolve } = Promise.withResolvers<void>();

    waiters.push(resolve);
    await promise;
  }

  const session = sessions[index];

  if (session === undefined) throw new Error('the peer has no such session');

  return session;
}
