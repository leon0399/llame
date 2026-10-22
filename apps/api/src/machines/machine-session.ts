/**
 * One Machine session: the framed, multiplexed conversation the hub holds with
 * a daemon over one transport (remote-machines design D2/D3).
 *
 * The session owns the wire facts the rest of the hub must not re-derive: the
 * `hello` handshake and its version check, the liveness heartbeat, stream ids,
 * and the classification of an end into exactly one failure reason. It also
 * answers the one question the effect fence needs — whether a request had
 * already reached the link when it failed (`sent`) — by counting the frames it
 * actually wrote, so "failed before dispatch" and "lost after dispatch" are
 * distinguished from evidence rather than from timing.
 */

import type { Readable, Writable } from 'node:stream';

import * as Sentry from '@sentry/nestjs';

import {
  createFrameMultiplexer,
  createHeartbeat,
  createLineFramer,
  decodeFrame,
  encodeFrame,
  FrameSizeError,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISSES,
  MachineProtocolError,
  PING_NOTIFICATION,
  PROTOCOL_VERSION,
  type Frame,
  type FrameMultiplexer,
  type Heartbeat,
  type HelloResult,
  type JsonValue,
  type MachineChannel,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import { classifySshLinkFailure } from '../ssh/ssh-process';
import { readHelloResult } from './machine-results';
import {
  type MachineLinkEnd,
  type MachineTransport,
} from './machine-transport';
import type { MachineFailureReason } from './machines-status';

/** How long a handshake may take before the session gives up on the Machine. */
export const HANDSHAKE_TIMEOUT_MS = 30_000;

/** The budget a caller names when it has no Run timeout of its own to pass. */
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;

/** The durable identity and time budget a Machine request carries. */
export type MachineRequestEnvelope = {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySeq?: number;
  /** Relative budget measured on the Machine's monotonic clock. */
  readonly budgetMs: number;
};

export type MachineRequestOptions = {
  readonly signal?: AbortSignal;
  /** Relative budget measured on the Machine's monotonic clock. */
  readonly budgetMs?: number;
  readonly envelope?: MachineRequestEnvelope;
};

/**
 * The call's params with the active trace in their envelope, so the daemon's
 * spans join the trace that issued the call. Without an active trace, or for
 * a method that carries no envelope, the params are unchanged.
 */
function tracedParams<M extends MachineMethod>(
  call: MachineCall<M>,
): MachineMethodParams[M] {
  const { 'sentry-trace': sentryTrace, baggage } = Sentry.getTraceData();
  const params = call.params;
  if (sentryTrace === undefined || !('envelope' in params)) return params;
  return {
    ...params,
    envelope: {
      ...params.envelope,
      trace: { sentryTrace, ...(baggage !== undefined && { baggage }) },
    },
  };
}

/** `@sentry/core`'s error status code, which `@sentry/nestjs` does not export. */
const SPAN_STATUS_ERROR = 2;

/**
 * The hub's span for one Machine call: Sentry's `rpc` op with its rpc and
 * jsonrpc semantic conventions. The daemon's server span uses the same
 * service and method.
 */
function machineRpcSpan(method: MachineMethod) {
  return {
    name: `llame-machine/${method}`,
    op: 'rpc',
    attributes: {
      'rpc.system.name': 'jsonrpc',
      'rpc.service': 'llame-machine',
      'rpc.method': method,
      'jsonrpc.protocol.version': '2.0',
    },
  };
}

/**
 * One method invocation: the wire name and its params, INCLUDING the envelope.
 * The params type is the protocol's own, so no hub-side composition has to
 * rebuild a generic mapped type (which TypeScript cannot prove and would force
 * an assertion).
 */
export type MachineCall<M extends MachineMethod = MachineMethod> = {
  readonly method: M;
  readonly params: MachineMethodParams[M];
};

/** An open stream: the protocol channel, and the answer it is awaiting. */
export type MachineChannelHandle = {
  readonly channel: MachineChannel;
  readonly result: Promise<JsonValue>;
};

/** Why a session ended: a failure reason, or llame's own clean close. */
export type MachineSessionEndReason = MachineFailureReason | 'closed';

export type MachineSessionEnd = {
  readonly reason: MachineSessionEndReason;
  /** Whether the handshake had completed before the end. */
  readonly established: boolean;
};

/**
 * A Machine operation could not be carried out. `sent` distinguishes a failure
 * BEFORE dispatch (nothing reached the Machine, so `machine_unavailable` is
 * safe) from a session lost AFTER the request frame was written (the effect is
 * unknown, so the caller settles it as `outcome_unknown`).
 */
export class MachineUnavailableError extends Error {
  constructor(
    readonly machine: string,
    readonly reason: MachineFailureReason,
    readonly sent: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'MachineUnavailableError';
  }
}

export type MachineSessionOptions = {
  readonly name: string;
  readonly transport: MachineTransport;
  readonly hubVersion: string;
  readonly handshakeTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatMisses?: number;
};

type EndInput =
  | { readonly kind: 'failure'; readonly reason: MachineFailureReason }
  | { readonly kind: 'closed' }
  | { readonly kind: 'link' };

export class MachineSession {
  readonly name: string;
  private readonly endSignal = Promise.withResolvers<MachineSessionEnd>();
  /** Resolves once the session has ended, with its classified reason. */
  readonly ended: Promise<MachineSessionEnd> = this.endSignal.promise;
  /** Frames from the Machine. */
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly transport: MachineTransport;
  private readonly hubVersion: string;
  private readonly handshakeTimeoutMs: number;
  private readonly framer = createLineFramer();
  private readonly multiplexer: FrameMultiplexer;
  private readonly heartbeat: Heartbeat;
  private helloResult: HelloResult | undefined;
  private handshake: Promise<HelloResult> | undefined;
  private end: MachineSessionEnd | undefined;
  private established = false;
  /** Frames this session actually wrote to the link, for the `sent` answer. */
  private framesWritten = 0;

  constructor(options: MachineSessionOptions) {
    this.name = options.name;
    this.input = options.transport.input;
    this.output = options.transport.output;
    this.transport = options.transport;
    this.hubVersion = options.hubVersion;
    this.handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.multiplexer = createFrameMultiplexer({
      send: (frame) => this.writeFrame(frame),
    });
    this.heartbeat = createHeartbeat({
      intervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      misses: options.heartbeatMisses ?? HEARTBEAT_MISSES,
      sendPing: () => this.multiplexer.control.notify(PING_NOTIFICATION),
      onLost: () => this.finish({ kind: 'failure', reason: 'session_lost' }),
    });
    this.input.on('data', (chunk: Buffer) => this.receive(chunk));
    this.input.on('end', () => this.endFromLink());
    this.input.on('close', () => this.endFromLink());
    this.input.on('error', () => this.endFromLink());
    this.output.on('error', () => this.endFromLink());
    this.heartbeat.start();
  }

  /** Open streams this session still carries; zero means it may idle out. */
  get openStreams(): number {
    return this.multiplexer.openStreams;
  }

  /** Whether the handshake completed and the session is still live. */
  get isReady(): boolean {
    return this.established && this.end === undefined;
  }

  /** The completed end, once it happened. */
  get endReason(): MachineSessionEnd | undefined {
    return this.end;
  }

  /** The handshake's result; one attempt per session, never retried. */
  ready(): Promise<HelloResult> {
    this.handshake ??= this.performHandshake();
    return this.handshake;
  }

  /**
   * Send one request and resolve its decoded, untrusted answer. A Machine
   * refusal (`MachineProtocolError`) travels unchanged; a lost or unavailable
   * session becomes a {@link MachineUnavailableError} whose `sent` says whether
   * the frame had reached the link.
   */
  async request<M extends MachineMethod>(
    call: MachineCall<M>,
    options: MachineRequestOptions = {},
  ): Promise<JsonValue> {
    // A signal aborted before the frame exists cannot cancel anything: the
    // protocol's stream request only observes aborts after it is written, so a
    // pre-aborted signal must fail here rather than reach it.
    options.signal?.throwIfAborted();
    return Sentry.startSpan(machineRpcSpan(call.method), async () => {
      const channel = this.openStream();
      const before = this.framesWritten;
      const answer = channel.request(call.method, tracedParams(call), {
        signal: options.signal,
      });
      const sent = this.framesWritten > before;
      try {
        return await answer;
      } catch (error) {
        throw this.failure(error, sent, options.signal);
      } finally {
        channel.close();
      }
    });
  }

  /**
   * Open a stream that stays open after its answer (a Workspace MCP channel).
   * Its span ends with the answer, not with the stream.
   */
  openChannel<M extends MachineMethod>(
    call: MachineCall<M>,
    options: MachineRequestOptions = {},
  ): MachineChannelHandle {
    options.signal?.throwIfAborted();
    // Refused before the span starts: a manual span left open by a throw
    // would never be sent.
    const channel = this.openStream();
    return Sentry.startSpanManual(machineRpcSpan(call.method), (span) => {
      const before = this.framesWritten;
      const answer = channel.request(call.method, tracedParams(call), {
        signal: options.signal,
      });
      const sent = this.framesWritten > before;
      const result = this.reclassify(answer, sent, options.signal);
      result.then(
        () => span.end(),
        () => {
          span.setStatus({ code: SPAN_STATUS_ERROR });
          span.end();
        },
      );
      return { channel, result };
    });
  }

  /** End the session politely: an idle close or a process shutting down. */
  close(): void {
    this.finish({ kind: 'closed' });
  }

  /** One inbound frame: records liveness, then routes the line. */
  private receive(chunk: Buffer): void {
    this.heartbeat.record();
    const events = this.framer.push(chunk);
    for (const event of events) {
      if (event.kind === 'oversize') {
        this.finish({ kind: 'failure', reason: 'session_lost' });
        return;
      }
      this.deliver(event.line);
    }
  }

  private deliver(line: string): void {
    const decoded = decodeFrame(line);
    if (decoded.ok) {
      this.multiplexer.handle(decoded.frame);
      return;
    }
    if (decoded.streamId === undefined) return;
    // The frame names a stream, so the refusal travels back on that stream
    // instead of the session going silent.
    this.multiplexer.refuseStream(
      decoded.streamId,
      'invalid_params',
      decoded.reason === 'oversize'
        ? 'The frame exceeds the byte bound of this protocol.'
        : 'The frame is not a JSON-RPC message.',
    );
  }

  private writeFrame(frame: Frame): void {
    try {
      this.output.write(encodeFrame(frame));
      this.framesWritten += 1;
    } catch (error) {
      if (!(error instanceof FrameSizeError)) {
        // The link is gone. Ending the session rejects every pending stream,
        // and `framesWritten` keeps this frame honestly unsent.
        this.finish({ kind: 'failure', reason: 'session_lost' });
        return;
      }
      this.multiplexer.refuseStream(
        frame.s,
        'internal',
        'The answer exceeds the frame byte bound of this protocol.',
      );
    }
  }

  private endFromLink(): void {
    // The classification waits for the link's own exit status and stderr, so a
    // refused host key is reported as such rather than as a generic loss.
    void this.transport.ended.then((end) => this.finish({ kind: 'link', end }));
  }

  private finish(input: EndInput & { end?: MachineLinkEnd }): void {
    if (this.end !== undefined) return;
    this.end = {
      reason: this.classify(input),
      established: this.established,
    };
    this.heartbeat.stop();
    this.multiplexer.close();
    this.input.destroy();
    this.transport.close();
    this.endSignal.resolve(this.end);
  }

  private classify(
    input: EndInput & { end?: MachineLinkEnd },
  ): MachineSessionEndReason {
    if (input.kind === 'failure') return input.reason;
    if (input.kind === 'closed') return 'closed';
    const end = input.end;
    return end === undefined
      ? classifySshLinkFailure(this.established, '')
      : classifySshLinkFailure(this.established, end.diagnostic);
  }

  private openStream(): MachineChannel {
    const end = this.end;
    if (end !== undefined)
      throw new MachineUnavailableError(
        this.name,
        end.reason === 'closed' ? 'session_lost' : end.reason,
        false,
        'The Machine session has already ended.',
      );
    try {
      return this.multiplexer.open();
    } catch (error) {
      throw new MachineUnavailableError(
        this.name,
        'session_lost',
        false,
        error instanceof Error
          ? error.message
          : 'The Machine session is closed.',
      );
    }
  }

  private async performHandshake(): Promise<HelloResult> {
    const timer = setTimeout(
      () => this.finish({ kind: 'failure', reason: 'unreachable' }),
      this.handshakeTimeoutMs,
    );
    timer.unref();
    try {
      const answer = this.multiplexer.control.request('hello', {
        protocolVersion: PROTOCOL_VERSION,
        hubVersion: this.hubVersion,
      });
      const hello = readHelloResult(await answer);
      if (hello === undefined || hello.protocolVersion !== PROTOCOL_VERSION) {
        this.finish({ kind: 'failure', reason: 'incompatible_version' });
        throw new MachineUnavailableError(
          this.name,
          'incompatible_version',
          false,
          'The Machine answered an unusable handshake.',
        );
      }
      this.established = true;
      this.helloResult = hello;
      return hello;
    } catch (error) {
      // A daemon that refuses the handshake — the only refusal the protocol
      // defines for `hello` — is never used, whatever it said.
      if (error instanceof MachineProtocolError) {
        this.finish({ kind: 'failure', reason: 'incompatible_version' });
        throw new MachineUnavailableError(
          this.name,
          'incompatible_version',
          false,
          `The Machine refused the handshake: ${error.message}`,
        );
      }
      throw this.failure(error, false, undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The handshake result this session already produced, if any. */
  get hello(): HelloResult | undefined {
    return this.helloResult;
  }

  /** Convert any failure into the error vocabulary callers act on. */
  private failure(
    error: unknown,
    sent: boolean,
    signal: AbortSignal | undefined,
  ): Error {
    if (error instanceof MachineProtocolError) return error;
    if (error instanceof MachineUnavailableError) return error;
    // A caller's own cancellation is not a Machine failure.
    if (signal?.aborted === true) return toError(error);
    const end = this.end;
    const reason =
      end !== undefined && end.reason !== 'closed'
        ? end.reason
        : 'session_lost';
    return new MachineUnavailableError(
      this.name,
      reason,
      sent,
      describe(error),
    );
  }

  private reclassify(
    answer: Promise<JsonValue>,
    sent: boolean,
    signal: AbortSignal | undefined,
  ): Promise<JsonValue> {
    return answer.catch((error: unknown) => {
      throw this.failure(error, sent, signal);
    });
  }
}

/** A thrown value as an Error, for the paths that only pass one along. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The Machine session failed.';
}
