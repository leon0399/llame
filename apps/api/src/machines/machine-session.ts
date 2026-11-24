import { Code, ConnectError, createClient, type CallOptions, type Client } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import type { GenService } from '@bufbuild/protobuf/codegenv2';
import * as Sentry from '@sentry/nestjs';
import {
  BootstrapService, FileService, GitService, JobService, MachineService, McpService,
  ErrorDetailSchema, ErrorReason,
  GetInfoRequestSchema, GetLimitsRequestSchema, ListRootsRequestSchema,
  MACHINE_PROTOCOL_VERSION, MachineProtocolError, connectStdio, type HelloResult, type JsonValue,
  type MachineMethod, type MachineMethodParams, type MachineMethodResults, isMachineErrorCode,
} from '@workspace/machine-protocol';
import { classifySshLinkFailure } from '../ssh/ssh-process';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';
import { dispatchWireHandler } from './wire/index';
import type { MachineFailureReason } from './machines-status';

export const HANDSHAKE_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;
export type MachineRequestEnvelope = {
  readonly runId?: string; readonly attemptId?: string; readonly toolCallId?: string;
  readonly deliverySeq?: number; readonly budgetMs: number;
};
export type MachineRequestOptions = {
  readonly signal?: AbortSignal; readonly budgetMs?: number; readonly envelope?: MachineRequestEnvelope;
  readonly onNotification?: (notification: { readonly method: string; readonly params?: JsonValue }) => void;
};
export type MachineCall<M extends MachineMethod = MachineMethod> = {
  readonly method: M; readonly params: MachineMethodParams[M];
};
export type MachineSessionEndReason = MachineFailureReason | 'closed';
export type MachineSessionEnd = { readonly reason: MachineSessionEndReason; readonly established: boolean };

export class MachineUnavailableError extends Error {
  constructor(readonly machine: string, readonly reason: MachineFailureReason, readonly sent: boolean, message: string) {
    super(message); this.name = 'MachineUnavailableError';
  }
}
export class MachineIdentityMismatchError extends MachineUnavailableError {
  constructor(machine: string) {
    super(machine, 'identity_mismatch', false, 'The Machine answered with a different identity than the one bound to its name.');
    this.name = 'MachineIdentityMismatchError';
  }
}
export class MachineUpdateRequiredError extends Error {
  constructor(machine: string, method: string) {
    super(`The llame-machine daemon on ${machine} does not implement ${method}. Update the daemon on that Machine.`);
    this.name = 'MachineUpdateRequiredError';
  }
}
export type MachineChannel = {
  readonly closed: boolean;
  close(): void;
  onClose(callback: () => void): void;
  onNotification(callback: (notification: { readonly method: string; readonly params?: JsonValue }) => void): void;
  notify(method: string, params?: JsonValue): void;
};
export type MachineChannelHandle = { readonly channel: MachineChannel; readonly result: Promise<JsonValue> };
export type MachineStreamHandler = (
  method: string,
  params: Record<string, unknown>,
  notify: (notification: { readonly method: string; readonly params?: JsonValue }) => void,
  send: (frame: unknown) => void,
  options: MachineRequestOptions,
) => Promise<JsonValue>;

export type MachineRequestHandler = (method: string, params: Record<string, unknown>, options: MachineRequestOptions) => Promise<JsonValue>;
export type MachineSessionOptions = {
  readonly name: string; readonly transport: MachineTransport; readonly hubVersion: string;
  readonly handshakeTimeoutMs?: number; readonly requestHandler?: MachineRequestHandler;
  readonly streamHandler?: MachineStreamHandler;
};

type RpcService = GenService<any>;
type RpcClient = Client<RpcService>;
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
  private readonly clientsByService = new Map<RpcService, RpcClient>();
  private resolveEnded!: (end: MachineSessionEnd) => void;
  private end: MachineSessionEnd | undefined;
  private helloResult: HelloResult | undefined;
  private handshake: Promise<HelloResult> | undefined;
  private established = false;
  private active = 0;

  constructor(private readonly options: MachineSessionOptions) {
    this.name = options.name;
    this.ended = new Promise((resolve) => { this.resolveEnded = resolve; });
    this.connection = 'rpcTransport' in options.transport
      ? { transport: options.transport.rpcTransport, close: () => options.transport.close() }
      : connectStdio({
          streams: {
            input: options.transport.input,
            output: options.transport.output,
            close: () => options.transport.close(),
          },
        });
    this.clients = {
      bootstrap: this.client(BootstrapService) as Client<typeof BootstrapService>,
      machine: this.client(MachineService) as Client<typeof MachineService>,
      files: this.client(FileService) as Client<typeof FileService>,
      jobs: this.client(JobService) as Client<typeof JobService>,
      git: this.client(GitService) as Client<typeof GitService>,
      mcp: this.client(McpService) as Client<typeof McpService>,
    };
    void options.transport.ended.then((end) => this.finish({ kind: 'link', end }));
  }
  get openStreams(): number { return this.active; }
  retain(): void { this.active += 1; }
  release(): void { this.active = Math.max(0, this.active - 1); }
  get isReady(): boolean { return this.established && this.end === undefined; }
  get endReason(): MachineSessionEnd | undefined { return this.end; }
  get hello(): HelloResult | undefined { return this.helloResult; }
  get jobsClient(): Client<typeof JobService> { return this.clients.jobs; }
  ready(): Promise<HelloResult> { this.handshake ??= this.performHandshake(); return this.handshake; }
  callOptions(options: MachineRequestOptions = {}): CallOptions {
    const headers = new Headers();
    const trace = Sentry.getTraceData();
    if (trace['sentry-trace'] !== undefined) headers.set('sentry-trace', trace['sentry-trace']);
    if (trace.baggage !== undefined) headers.set('baggage', trace.baggage);
    if (options.envelope?.toolCallId !== undefined) headers.set('x-llame-tool-call-id', options.envelope.toolCallId);
    return {
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: options.budgetMs ?? options.envelope?.budgetMs ?? DEFAULT_REQUEST_BUDGET_MS,
    };
  }
  async call<M extends MachineMethod>(method: M, params: MachineMethodParams[M], options: MachineRequestOptions = {}): Promise<MachineMethodResults[M]> {
    options.signal?.throwIfAborted();
    if (this.end !== undefined) throw new MachineUnavailableError(this.name, this.end.reason === 'closed' ? 'session_lost' : this.end.reason, false, 'The Machine session has ended.');
    if (this.options.requestHandler !== undefined) {
      return await this.options.requestHandler(method, params as Record<string, unknown>, options) as unknown as MachineMethodResults[M];
    }
    try {
      return await dispatchWireHandler(this, method, params, options);
    } catch (error) {
      throw this.mapRefusal(error, true);
    }
  }
  openChannel<M extends MachineMethod>(call: MachineCall<M>, options: MachineRequestOptions = {}): MachineChannelHandle {
    const listeners: Array<(notification: { readonly method: string; readonly params?: JsonValue }) => void> = [];
    const closeListeners: Array<() => void> = [];
    let closed = false;
    this.retain();
    const channel: MachineChannel = {
      get closed() { return closed; },
      close: () => {
        if (closed) return;
        closed = true;
        this.release();
        closeListeners.forEach((listener) => listener());
      },
      onClose: (callback) => { closeListeners.push(callback); if (closed) callback(); },
      onNotification: (callback) => listeners.push(callback),
      notify: () => undefined,
    };
    const notify = (notification: { readonly method: string; readonly params?: JsonValue }) => listeners.forEach((listener) => listener(notification));
    const result = this.options.streamHandler !== undefined
      ? this.options.streamHandler(call.method, call.params as Record<string, unknown>, notify, () => undefined, options)
      : this.call(call.method, call.params, { ...options, onNotification: notify }) as Promise<JsonValue>;
    void result.finally(() => channel.close()).catch(() => undefined);
    return { channel, result };
  }
  request<M extends MachineMethod>(call: MachineCall<M>, options: MachineRequestOptions = {}): Promise<JsonValue> {
    return this.call(call.method, call.params, options) as Promise<JsonValue>;
  }
  close(): void { this.finish({ kind: 'closed' }); }
  mapRefusal(error: unknown, sent = false): Error {
    if (!(error instanceof ConnectError)) return error instanceof Error ? error : new Error(String(error));
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
      if (code !== undefined && isMachineErrorCode(code)) return new MachineProtocolError(code, error.rawMessage);
    }
    if (error.code === Code.Unimplemented) return new MachineUpdateRequiredError(this.name, 'requested operation');
    if (error.code === Code.DeadlineExceeded) return new MachineProtocolError('budget_exhausted', 'Machine request budget exhausted.');
    return new MachineUnavailableError(this.name, 'session_lost', sent, error.rawMessage);
  }
  private client(service: RpcService): RpcClient {
    let client = this.clientsByService.get(service);
    if (client === undefined) { client = createClient(service, this.connection.transport); this.clientsByService.set(service, client); }
    return client;
  }
  private async performHandshake(): Promise<HelloResult> {
    const timeoutMs = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref();
    try {
      if (this.options.requestHandler !== undefined) {
        const result = await this.options.requestHandler('hello', { protocolVersion: MACHINE_PROTOCOL_VERSION, hubVersion: this.options.hubVersion }, { signal: controller.signal, budgetMs: timeoutMs });
        const hello = result as unknown as HelloResult;
        if (hello.protocolVersion !== MACHINE_PROTOCOL_VERSION) throw new MachineUpdateRequiredError(this.name, `protocol ${String(hello.protocolVersion)} (expected ${MACHINE_PROTOCOL_VERSION})`);
        this.established = true; this.helloResult = hello; return hello;
      }
      const callOptions: CallOptions = { signal: controller.signal, timeoutMs };
      const info = await this.clients.bootstrap.getInfo(create(GetInfoRequestSchema, {}), callOptions);
      if (info.protocolVersion !== MACHINE_PROTOCOL_VERSION) throw new MachineUpdateRequiredError(this.name, `protocol ${String(info.protocolVersion)} (expected ${MACHINE_PROTOCOL_VERSION})`);
      const [rootInfo, limits] = await Promise.all([
        this.clients.machine.listRoots(create(ListRootsRequestSchema, {}), callOptions),
        this.clients.machine.getLimits(create(GetLimitsRequestSchema, {}), callOptions),
      ]);
      const roots = rootInfo.roots.map((root) => root.path);
      const facts = info.facts;
      const hello: HelloResult = {
        protocolVersion: Number(info.protocolVersion), daemonVersion: info.release, roots,
        methods: ['git.inspect', 'git.locate', 'git.state', 'git.worktreeAdd', 'git.worktreeList', 'git.worktreeRemove'],
        instanceId: info.instanceId, buildId: info.buildId,
        facts: { os: facts?.os ?? '', arch: facts?.arch ?? '', kernel: facts?.kernel ?? '', cpuCount: facts?.cpuCount ?? 0,
          totalMemoryBytes: Number(facts?.memoryBytes ?? 0n),
          rootDisks: rootInfo.roots.map((root) => ({ root: root.path, totalBytes: root.filesystemBytes === undefined ? null : Number(root.filesystemBytes) })) },
      };
      void limits;
      this.established = true; this.helloResult = hello; return hello;
    } catch (cause) {
      if (cause instanceof MachineUnavailableError) throw cause;
      throw this.mapRefusal(cause);
    } finally { clearTimeout(timer); }
  }
  private finish(input: { kind: 'closed' } | { kind: 'link'; end: MachineLinkEnd }): void {
    if (this.end !== undefined) return;
    const reason = input.kind === 'closed' ? 'closed' : classifySshLinkFailure(this.established, input.end.diagnostic);
    this.end = { reason, established: this.established };
    this.connection.close(); this.resolveEnded(this.end);
  }
}

