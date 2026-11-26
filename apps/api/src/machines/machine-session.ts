import {
  createClient,
  type CallOptions,
  type Client,
} from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { z } from 'zod';

import * as Sentry from '@sentry/nestjs';
import {
  BootstrapService,
  FileService,
  GitService,
  JobService,
  MachineService,
  McpService,
  GetInfoRequestSchema,
  GetLimitsRequestSchema,
  ListRootsRequestSchema,
  connectStdio,
  MACHINE_PROTOCOL_VERSION,
  type HelloResult,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';
import { classifySshLinkFailure } from '../ssh/ssh-process';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';
import {
  MachineUnavailableError,
  MachineUpdateRequiredError,
  mapMachineRefusal,
} from './machine-session-errors';
import { dispatchWireHandler } from './wire/index';
import type { MachineFailureReason } from './machines-status';
import { createHelloResult } from './machine-session-handshake';

export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;

const helloResultSchema: z.ZodType<HelloResult> = z.object({
  protocolVersion: z.number(),
  daemonVersion: z.string(),
  roots: z.array(z.string()),
  instanceId: z.string(),
  buildId: z.string(),
  facts: z.object({
    os: z.string(),
    arch: z.string(),
    kernel: z.string(),
    cpuCount: z.number(),
    totalMemoryBytes: z.number(),
    rootDisks: z.array(
      z.object({ root: z.string(), totalBytes: z.number().nullable() }),
    ),
  }),
});

export type MachineRequestEnvelope = {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySeq?: number;
  readonly budgetMs: number;
};

export type MachineRequestOptions = {
  /** Present only on the in-process test adapter path. */
  readonly machineName?: string;
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
  readonly envelope?: MachineRequestEnvelope;
  readonly onNotification?: (notification: {
    readonly method: string;
    readonly params?: JsonValue;
  }) => void;
};

export type MachineCall<M extends MachineMethod = MachineMethod> = {
  readonly method: M;
  readonly params: MachineMethodParams[M];
};

export type MachineSessionEndReason = MachineFailureReason | 'closed';

export type MachineSessionEnd = {
  readonly reason: MachineSessionEndReason;
  readonly established: boolean;
};

export type MachineChannel = {
  readonly closed: boolean;
  close(): void;
  onClose(callback: () => void): void;
  onNotification(callback: (notification: MachineNotification) => void): void;
  notify(method: string, params?: JsonValue): void;
};

export type MachineChannelHandle = {
  readonly channel: MachineChannel;
  readonly result: Promise<JsonValue>;
};

function createChannel(release: () => void) {
  const listeners: Array<(notification: MachineNotification) => void> = [];
  const closeListeners: Array<() => void> = [];
  let closed = false;

  const channel: MachineChannel = {
    get closed() {
      return closed;
    },
    close: () => {
      if (closed) return;

      closed = true;
      release();
      closeListeners.forEach((listener) => listener());
    },
    onClose: (callback) => {
      closeListeners.push(callback);

      if (closed) callback();
    },
    onNotification: (callback) => listeners.push(callback),
    notify: () => undefined,
  };

  return {
    channel,
    notify: (notification: MachineNotification) =>
      listeners.forEach((listener) => listener(notification)),
  };
}

export type MachineNotification = {
  readonly method: string;
  readonly params?: JsonValue;
};

export type MachineStreamInvocation = {
  readonly method: MachineMethod;
  readonly params: MachineMethodParams[MachineMethod];
  readonly notify: (notification: MachineNotification) => void;
  readonly send: (frame: JsonValue) => void;
  readonly options: MachineRequestOptions;
};

export type MachineStreamHandler = (
  invocation: MachineStreamInvocation,
) => Promise<JsonValue>;

export type MachineRequestHandler = {
  (
    method: 'hello',
    params: { readonly protocolVersion: number; readonly hubVersion: string },
    options: MachineRequestOptions,
  ): Promise<JsonValue>;
  <M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions,
  ): Promise<JsonValue>;
};

export type MachineSessionOptions = {
  readonly name: string;
  readonly transport: MachineTransport;
  readonly hubVersion: string;
  readonly handshakeTimeoutMs?: number;
  readonly requestHandler?: MachineRequestHandler;
  readonly streamHandler?: MachineStreamHandler;
  readonly admitIdentity?: (instanceId: string) => Promise<void>;
};

export type MachineClients = {
  readonly bootstrap: Client<typeof BootstrapService>;
  readonly machine: Client<typeof MachineService>;
  readonly files: Client<typeof FileService>;
  readonly jobs: Client<typeof JobService>;
  readonly git: Client<typeof GitService>;
  readonly mcp: Client<typeof McpService>;
};

export class MachineSession {
  readonly name: string;
  readonly clients: MachineClients;
  readonly ended: Promise<MachineSessionEnd>;
  private readonly connection: ReturnType<typeof connectStdio>;
  private resolveEnded!: (end: MachineSessionEnd) => void;
  private end: MachineSessionEnd | undefined;
  private helloResult: HelloResult | undefined;
  private handshake: Promise<HelloResult> | undefined;
  private established = false;
  private readonly channels = new Set<MachineChannel>();
  private active = 0;
  constructor(private readonly options: MachineSessionOptions) {
    this.name = options.name;
    this.ended = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
    this.connection =
      'rpcTransport' in options.transport
        ? {
            transport: options.transport.rpcTransport,
            close: () => options.transport.close(),
          }
        : connectStdio({
            streams: {
              input: options.transport.input,
              output: options.transport.output,
              close: () => options.transport.close(),
            },
          });
    this.clients = {
      bootstrap: createClient(BootstrapService, this.connection.transport),
      machine: createClient(MachineService, this.connection.transport),
      files: createClient(FileService, this.connection.transport),
      jobs: createClient(JobService, this.connection.transport),
      git: createClient(GitService, this.connection.transport),
      mcp: createClient(McpService, this.connection.transport),
    };
    void options.transport.ended.then((end) =>
      this.finish({ kind: 'link', end }),
    );
  }
  get openStreams(): number {
    return this.active;
  }
  retain(): void {
    this.active += 1;
  }
  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
  get isReady(): boolean {
    return this.established && this.end === undefined;
  }
  get endReason(): MachineSessionEnd | undefined {
    return this.end;
  }
  get hello(): HelloResult | undefined {
    return this.helloResult;
  }
  get jobsClient(): Client<typeof JobService> {
    return this.clients.jobs;
  }
  ready(): Promise<HelloResult> {
    this.handshake ??= this.performHandshake();

    return this.handshake;
  }
  callOptions(options: MachineRequestOptions = {}): CallOptions {
    const headers = new Headers();
    const trace = Sentry.getTraceData();

    if (trace['sentry-trace'] !== undefined)
      headers.set('sentry-trace', trace['sentry-trace']);

    if (trace.baggage !== undefined) headers.set('baggage', trace.baggage);

    if (options.envelope?.toolCallId !== undefined)
      headers.set('x-llame-tool-call-id', options.envelope.toolCallId);

    const callOptions: CallOptions = {
      headers,
      timeoutMs:
        options.budgetMs ??
        options.envelope?.budgetMs ??
        DEFAULT_REQUEST_BUDGET_MS,
    };

    if (options.signal !== undefined) callOptions.signal = options.signal;

    return callOptions;
  }
  async call<M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions = {},
  ): Promise<JsonValue> {
    options.signal?.throwIfAborted();

    if (this.end !== undefined)
      throw new MachineUnavailableError(
        this.name,
        this.end.reason === 'closed' ? 'session_lost' : this.end.reason,
        false,
        'The Machine session has ended.',
      );

    if (this.options.requestHandler !== undefined) {
      try {
        return await this.options.requestHandler(method, params, {
          ...options,
          machineName: this.name,
        });
      } catch (error) {
        throw this.mapRefusal(error, true);
      }
    }

    try {
      return await dispatchWireHandler(this, method, params, options);
    } catch (error) {
      throw this.mapRefusal(error, true);
    }
  }
  openChannel<M extends MachineMethod>(
    call: MachineCall<M>,
    options: MachineRequestOptions = {},
  ): MachineChannelHandle {
    this.retain();
    const { channel, notify } = createChannel(() => this.release());
    this.channels.add(channel);

    channel.onClose(() => this.channels.delete(channel));

    const result =
      this.options.streamHandler === undefined
        ? this.call(call.method, call.params, {
            ...options,
            onNotification: notify,
          })
        : this.options.streamHandler({
            method: call.method,
            params: call.params,
            notify,
            send: () => undefined,
            options: { ...options, machineName: this.name },
          });

    void result.catch(() => channel.close());

    return { channel, result };
  }
  request<M extends MachineMethod>(
    call: MachineCall<M>,
    options: MachineRequestOptions = {},
  ): Promise<JsonValue> {
    return this.call(call.method, call.params, options);
  }
  close(): void {
    this.finish({ kind: 'closed' });
  }
  mapRefusal(error: unknown, sent = false): Error {
    return mapMachineRefusal(this.name, error, sent);
  }
  private async performHandshake(): Promise<HelloResult> {
    const timeoutMs = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();

    try {
      const hello = await this.requestHello(controller.signal, timeoutMs);

      if (hello.protocolVersion !== MACHINE_PROTOCOL_VERSION)
        throw new MachineUpdateRequiredError(
          this.name,
          `protocol ${String(hello.protocolVersion)} (expected ${MACHINE_PROTOCOL_VERSION})`,
        );

      if (this.options.requestHandler !== undefined)
        await this.options.admitIdentity?.(hello.instanceId);
      this.established = true;
      this.helloResult = hello;

      return hello;
    } catch (error) {
      return this.handleHandshakeFailure(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  private async requestHello(
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<HelloResult> {
    if (this.options.requestHandler === undefined)
      return this.performWireHandshake(signal, timeoutMs);

    const answer = await this.options.requestHandler(
      'hello',
      {
        protocolVersion: MACHINE_PROTOCOL_VERSION,
        hubVersion: this.options.hubVersion,
      },
      { signal, budgetMs: timeoutMs, machineName: this.name },
    );

    const result = helloResultSchema.safeParse(answer);

    if (!result.success) {
      this.finish({ kind: 'failure', reason: 'incompatible_version' });
      throw new MachineUnavailableError(
        this.name,
        'incompatible_version',
        false,
        'The Machine answered an unusable handshake.',
      );
    }

    return result.data;
  }
  private handleHandshakeFailure(error: unknown, signal: AbortSignal): never {
    if (error instanceof MachineUnavailableError) throw error;

    if (error instanceof MachineUpdateRequiredError) throw error;

    if (this.end !== undefined)
      throw new MachineUnavailableError(
        this.name,
        this.end.reason === 'closed' ? 'session_lost' : this.end.reason,
        false,
        'The Machine link ended before the handshake completed.',
      );

    if (signal.aborted)
      throw new MachineUnavailableError(
        this.name,
        'unreachable',
        false,
        'The Machine did not complete its handshake before the deadline.',
      );

    throw this.mapRefusal(error);
  }
  private async performWireHandshake(
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<HelloResult> {
    const callOptions: CallOptions = { signal, timeoutMs };

    const info = await this.clients.bootstrap.getInfo(
      create(GetInfoRequestSchema, {}),
      callOptions,
    );

    if (info.protocolVersion !== MACHINE_PROTOCOL_VERSION)
      throw new MachineUpdateRequiredError(
        this.name,
        `protocol ${String(info.protocolVersion)} (expected ${MACHINE_PROTOCOL_VERSION})`,
      );
    await this.options.admitIdentity?.(info.instanceId);

    const [rootInfo, limits] = await Promise.all([
      this.clients.machine.listRoots(
        create(ListRootsRequestSchema, {}),
        callOptions,
      ),
      this.clients.machine.getLimits(
        create(GetLimitsRequestSchema, {}),
        callOptions,
      ),
    ]);

    void limits;

    return createHelloResult(info, rootInfo);
  }
  private finish(
    input:
      | { kind: 'closed' }
      | { kind: 'failure'; reason: MachineFailureReason }
      | { kind: 'link'; end: MachineLinkEnd },
  ): void {
    if (this.end !== undefined) return;

    const reason =
      input.kind === 'closed'
        ? 'closed'
        : input.kind === 'failure'
          ? input.reason
          : classifySshLinkFailure(this.established, input.end.diagnostic);

    this.end = { reason, established: this.established };

    for (const channel of this.channels) channel.close();

    this.connection.close();
    this.resolveEnded(this.end);
  }
}
