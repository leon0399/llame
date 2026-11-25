import {
  Code,
  ConnectError,
  createClient,
  type CallOptions,
  type Client,
} from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import * as Sentry from '@sentry/nestjs';
import {
  BootstrapService,
  FileService,
  GitService,
  JobService,
  MachineService,
  McpService,
  ErrorDetailSchema,
  ErrorReason,
  GetInfoRequestSchema,
  GetLimitsRequestSchema,
  ListRootsRequestSchema,
  MACHINE_PROTOCOL_VERSION,
  MachineProtocolError,
  connectStdio,
  type HelloResult,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
  type MachineMethodResults,
  isMachineErrorCode,
} from '@workspace/machine-protocol';
import { classifySshLinkFailure } from '../ssh/ssh-process';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';
import {
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from './machine-session-errors';
import { dispatchWireHandler } from './wire/index';
import type { MachineFailureReason } from './machines-status';

export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;

export type MachineRequestEnvelope = {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySeq?: number;
  readonly budgetMs: number;
};

export type MachineRequestOptions = {
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

export type MachineRequestHandler = (
  method: string,
  params: JsonValue,
  options: MachineRequestOptions,
) => Promise<JsonValue>;

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
  ): Promise<MachineMethodResults[M]> {
    options.signal?.throwIfAborted();

    if (this.end !== undefined)
      throw new MachineUnavailableError(
        this.name,
        this.end.reason === 'closed' ? 'session_lost' : this.end.reason,
        false,
        'The Machine session has ended.',
      );

    if (this.options.requestHandler !== undefined) {
      const result = await this.options.requestHandler(method, params, options);

      // SAFETY: This injectable handler is a typed test seam for a known method.
      return result as MachineMethodResults[M];
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
    const { channel, notify } = createChannel(() => this.release());
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
            options,
          });

    void result.finally(() => channel.close()).catch(() => undefined);

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
    if (!(error instanceof ConnectError))
      return error instanceof Error ? error : new Error(String(error));
    const detail = error.findDetails(ErrorDetailSchema)[0];

    if (detail !== undefined) {
      const reasonMap: Partial<Record<ErrorReason, string>> = {
        [ErrorReason.PATH_NOT_REGISTERED]: 'path_not_registered',
        [ErrorReason.INVALID_ARGUMENT]: 'invalid_argument',
        [ErrorReason.JOB_LIMIT]: 'machine_job_limit',
        [ErrorReason.JOB_NOT_FOUND]: 'machine_job_not_found',
        [ErrorReason.JOB_RUNNING]: 'machine_job_running',
      };

      const code = reasonMap[detail.reason];

      if (code !== undefined && isMachineErrorCode(code))
        return new MachineProtocolError(code, error.rawMessage);
    }

    if (error.code === Code.Unimplemented)
      return new MachineUpdateRequiredError(this.name, 'requested operation');

    if (error.code === Code.DeadlineExceeded)
      return new MachineProtocolError(
        'budget_exhausted',
        'Machine request budget exhausted.',
      );

    return new MachineUnavailableError(
      this.name,
      'session_lost',
      sent,
      error.rawMessage,
    );
  }
  private async performHandshake(): Promise<HelloResult> {
    const timeoutMs = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();

    try {
      if (this.options.requestHandler !== undefined) {
        const result = await this.options.requestHandler(
          'hello',
          {
            protocolVersion: MACHINE_PROTOCOL_VERSION,
            hubVersion: this.options.hubVersion,
          },
          { signal: controller.signal, budgetMs: timeoutMs },
        );

        const hello = result as unknown as HelloResult;

        if (hello.protocolVersion !== MACHINE_PROTOCOL_VERSION)
          throw new MachineUpdateRequiredError(
            this.name,
            `protocol ${String(hello.protocolVersion)} (expected ${MACHINE_PROTOCOL_VERSION})`,
          );
        await this.options.admitIdentity?.(hello.instanceId);
        this.established = true;
        this.helloResult = hello;

        return hello;
      }

      const callOptions: CallOptions = { signal: controller.signal, timeoutMs };

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

      const roots = rootInfo.roots.map((root) => root.path);
      const facts = info.facts;

      const hello: HelloResult = {
        protocolVersion: Number(info.protocolVersion),
        daemonVersion: info.release,
        roots,
        methods: [
          'git.inspect',
          'git.locate',
          'git.state',
          'git.worktreeAdd',
          'git.worktreeList',
          'git.worktreeRemove',
        ],
        instanceId: info.instanceId,
        buildId: info.buildId,
        facts: {
          os: facts?.os ?? '',
          arch: facts?.arch ?? '',
          kernel: facts?.kernel ?? '',
          cpuCount: facts?.cpuCount ?? 0,
          totalMemoryBytes: Number(facts?.memoryBytes ?? 0n),
          rootDisks: rootInfo.roots.map((root) => ({
            root: root.path,
            totalBytes:
              root.filesystemBytes === undefined
                ? null
                : Number(root.filesystemBytes),
          })),
        },
      };

      void limits;
      this.established = true;
      this.helloResult = hello;

      return hello;
    } catch (error) {
      if (error instanceof MachineUnavailableError) throw error;
      if (error instanceof MachineUpdateRequiredError) throw error;
      if (this.end !== undefined)
        throw new MachineUnavailableError(
          this.name,
          this.end.reason === 'closed' ? 'session_lost' : this.end.reason,
          false,
          'The Machine link ended before the handshake completed.',
        );
      if (controller.signal.aborted)
        throw new MachineUnavailableError(
          this.name,
          'unreachable',
          false,
          'The Machine did not complete its handshake before the deadline.',
        );
      throw this.mapRefusal(error);
    } finally {
      clearTimeout(timer);
    }
  }
  private finish(
    input: { kind: 'closed' } | { kind: 'link'; end: MachineLinkEnd },
  ): void {
    if (this.end !== undefined) return;

    const reason =
      input.kind === 'closed'
        ? 'closed'
        : classifySshLinkFailure(this.established, input.end.diagnostic);

    this.end = { reason, established: this.established };
    this.connection.close();
    this.resolveEnded(this.end);
  }
}
