import type { Readable, Writable } from "node:stream";
import * as Sentry from "@sentry/node";
import {
  BUDGET_EXHAUSTED_MESSAGE,
  CONTROL_STREAM_ID,
  createFrameMultiplexer,
  createHeartbeat,
  createLineFramer,
  decodeFrame,
  encodeFrame,
  FrameSizeError,
  GIT_METHODS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISSES,
  INCOMPATIBLE_VERSION_MESSAGE,
  PING_NOTIFICATION,
  PROTOCOL_VERSION,
  type Frame,
  type FrameMultiplexer,
  type FramerEvent,
  type Heartbeat,
  type JsonRpcRequest,
  type JsonValue,
  type LineFramer,
  type MachineChannel,
  type MachineErrorCode,
  type RequestEnvelope,
} from "@workspace/machine-protocol";
import { readRoots } from "./roots";
import { createSignal } from "./signal";
import { rootsFileFor } from "./env";
import { DAEMON_VERSION } from "./version";
import { createRootGuard, type RootGuard } from "./guard";
import { createBashProcesses, type BashProcesses } from "./processes";
import { MachineRequestError } from "./errors";
import { executeOperation, isOperation, keepsStreamOpen } from "./dispatch";
import type { Operation, OperationContext } from "./dispatch-types";
import { readEnvelope, readHelloParams } from "./params";
import { startRequestBudget, type RequestBudget } from "./budget";

/** Why a session ended; the CLI maps it to an exit status. */
export type SessionEndReason =
  | "closed"
  | "input_ended"
  | "heartbeat_lost"
  | "incompatible_version"
  | "protocol_error";

export type ServeMachineOptions = {
  /** Registered roots; the default is the ones in this Machine's roots file. */
  readonly roots?: ReadonlyArray<string>;
  readonly configDir?: string;
  readonly daemonVersion?: string;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatMisses?: number;
};

export type MachineSession = {
  /** Resolves once the session ended and every process group it started stopped. */
  readonly done: Promise<SessionEndReason>;
  readonly stop: (reason?: SessionEndReason) => void;
};

const OVERSIZE_FRAME_MESSAGE =
  "The frame's message exceeds the byte bound of this protocol.";
const MALFORMED_FRAME_MESSAGE = "The frame is not a JSON-RPC message.";
const NO_HANDSHAKE_MESSAGE =
  "The Machine session has not completed its handshake.";
const OVERSIZE_ANSWER_MESSAGE =
  "The Machine's answer exceeds the frame byte bound of this protocol.";
const FAILED_OPERATION_MESSAGE = "The Machine operation failed.";
/** The `rpc.service` both ends of a Machine call report. */
const MACHINE_RPC_SERVICE = "llame-machine";

type Session = {
  readonly input: Readable;
  readonly roots: ReadonlyArray<string>;
  readonly guard: RootGuard;
  readonly processes: BashProcesses;
  readonly daemonVersion: string;
  readonly multiplexer: FrameMultiplexer;
  readonly heartbeat: Heartbeat;
  readonly framer: LineFramer;
  readonly resolveDone: (reason: SessionEndReason) => void;
  helloed: boolean;
  ended: SessionEndReason | undefined;
  readonly done: Promise<SessionEndReason>;
  readonly stop: (reason: SessionEndReason) => void;
};

function refuse(
  channel: MachineChannel,
  code: MachineErrorCode,
  message: string,
): void {
  channel.error(code, message);
  channel.close();
}

function reportError(
  channel: MachineChannel,
  error: unknown,
  budget?: RequestBudget,
): void {
  if (budget !== undefined && budget.expired()) {
    refuse(channel, "budget_exhausted", BUDGET_EXHAUSTED_MESSAGE);
    return;
  }
  if (error instanceof MachineRequestError) {
    refuse(channel, error.code, error.message);
    return;
  }
  // A stack or a host path never reaches the hub; stderr is the operator's.
  console.error("llame-machine: operation failed", error);
  Sentry.captureException(error);
  refuse(channel, "internal", FAILED_OPERATION_MESSAGE);
}

function handleHello(
  session: Session,
  channel: MachineChannel,
  request: JsonRpcRequest,
): void {
  let protocolVersion: number;
  try {
    protocolVersion = readHelloParams(request.params).protocolVersion;
  } catch (error) {
    reportError(channel, error);
    return;
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    channel.error("incompatible_version", INCOMPATIBLE_VERSION_MESSAGE, {
      hubProtocolVersion: protocolVersion,
      daemonProtocolVersion: PROTOCOL_VERSION,
    });
    session.stop("incompatible_version");
    return;
  }
  session.helloed = true;
  channel.result({
    protocolVersion: PROTOCOL_VERSION,
    daemonVersion: session.daemonVersion,
    roots: [...session.roots],
    // Additive: the version stays 1, and a hub reads this list to know
    // whether this daemon answers the git methods.
    methods: [...GIT_METHODS],
  });
}

/**
 * Runs one operation as an `rpc` transaction continuing the hub's trace from
 * its envelope, so the hub's span for the call contains the daemon's work.
 * Name and attributes follow Sentry's rpc and jsonrpc semantic conventions.
 */
function withHubTrace<T>(
  envelope: RequestEnvelope,
  request: JsonRpcRequest,
  work: () => Promise<T>,
): Promise<T> {
  const span = {
    name: `${MACHINE_RPC_SERVICE}/${request.method}`,
    op: "rpc",
    forceTransaction: true,
    attributes: {
      "rpc.system.name": "jsonrpc",
      "rpc.service": MACHINE_RPC_SERVICE,
      "rpc.method": request.method,
      "jsonrpc.protocol.version": request.jsonrpc,
      "jsonrpc.request.id": String(request.id),
    },
  };
  return Sentry.continueTrace(
    {
      sentryTrace: envelope.trace?.sentryTrace,
      baggage: envelope.trace?.baggage,
    },
    () => Sentry.startSpan(span, work),
  );
}

function runOperation(
  session: Session,
  channel: MachineChannel,
  request: JsonRpcRequest,
  method: Operation,
): void {
  let envelope: RequestEnvelope;
  try {
    envelope = readEnvelope(request.params, method);
  } catch (error) {
    reportError(channel, error);
    return;
  }
  if (envelope.budgetMs <= 0) {
    refuse(channel, "budget_exhausted", BUDGET_EXHAUSTED_MESSAGE);
    return;
  }
  const budget = startRequestBudget(envelope.budgetMs, channel.signal);
  void withHubTrace(envelope, request, () =>
    executeOperation(
      method,
      request.params,
      operationContext(session, channel, budget, envelope),
    ),
  )
    .then(
      (result) => {
        if (budget.expired())
          refuse(channel, "budget_exhausted", BUDGET_EXHAUSTED_MESSAGE);
        else channel.result(result);
      },
      (error: unknown) => {
        reportError(channel, error, budget);
      },
    )
    .finally(() => {
      budget.dispose();
      // A stream-keeping operation (`mcp.open`) relays until the server dies
      // or the hub cancels, and closes its own stream then.
      if (!keepsStreamOpen(method)) channel.close();
    });
}

function operationContext(
  session: Session,
  channel: MachineChannel,
  budget: RequestBudget,
  envelope: RequestEnvelope,
): OperationContext {
  return {
    roots: session.roots,
    guard: session.guard,
    processes: session.processes,
    signal: budget.signal,
    streamSignal: channel.signal,
    toolCallId: envelope.toolCallId,
    notify: (notification: string, params: JsonValue) =>
      channel.notify(notification, params),
    onNotification: (handler) => channel.onNotification(handler),
    closeStream: () => channel.close(),
  };
}

function handleRequest(
  session: Session,
  channel: MachineChannel,
  request: JsonRpcRequest,
): void {
  if (channel.id === CONTROL_STREAM_ID) {
    handleHello(session, channel, request);
    return;
  }
  if (!session.helloed) {
    refuse(channel, "internal", NO_HANDSHAKE_MESSAGE);
    return;
  }
  if (!isOperation(request.method)) {
    refuse(channel, "internal", `Unknown method: ${request.method}`);
    return;
  }
  runOperation(session, channel, request, request.method);
}

function writeFrame(session: Session, output: Writable, frame: Frame): void {
  try {
    output.write(encodeFrame(frame));
  } catch (error) {
    if (!(error instanceof FrameSizeError)) throw error;
    session.multiplexer.refuseStream(
      frame.s,
      "internal",
      OVERSIZE_ANSWER_MESSAGE,
    );
  }
}

function endSession(session: Session, reason: SessionEndReason): void {
  if (session.ended !== undefined) return;
  session.ended = reason;
  session.heartbeat.stop();
  session.multiplexer.close();
  session.input.destroy();
  // The session is over only once every process group it started is gone.
  void session.processes.settled().then(() => {
    session.resolveDone(reason);
  });
}

function handleFramerEvent(session: Session, event: FramerEvent): void {
  if (event.kind === "oversize") {
    // A line past the wrapper bound names no stream to refuse, so the session
    // ends rather than the frame disappearing.
    session.stop("protocol_error");
    return;
  }
  const decoded = decodeFrame(event.line);
  if (decoded.ok) {
    session.multiplexer.handle(decoded.frame);
    return;
  }
  if (decoded.streamId === undefined) return;
  session.multiplexer.refuseStream(
    decoded.streamId,
    "invalid_params",
    decoded.reason === "oversize"
      ? OVERSIZE_FRAME_MESSAGE
      : MALFORMED_FRAME_MESSAGE,
  );
}

async function pump(input: Readable, session: Session): Promise<void> {
  await new Promise<void>((resolve) => {
    input.on("data", (chunk: Buffer) => {
      session.heartbeat.record();
      for (const event of session.framer.push(chunk))
        handleFramerEvent(session, event);
    });
    // End, close, and error all end the session: the hub either closed its
    // side or the path between them went away.
    input.once("end", () => {
      resolve();
    });
    input.once("close", () => {
      resolve();
    });
    input.once("error", () => {
      resolve();
    });
  });
  session.stop("input_ended");
}

export function serveMachine(
  input: Readable,
  output: Writable,
  options: ServeMachineOptions = {},
): MachineSession {
  const session = openSession(input, output, options);
  void pump(input, session);
  return {
    done: session.done,
    stop: (reason = "closed") => {
      session.stop(reason);
    },
  };
}

function openSession(
  input: Readable,
  output: Writable,
  options: ServeMachineOptions,
): Session {
  const roots = options.roots ?? readRoots(rootsFileFor(options.configDir));
  const signal = createSignal<SessionEndReason>();
  const multiplexer = createFrameMultiplexer({
    send: (frame) => writeFrame(session, output, frame),
    onRequest: (channel, request) => handleRequest(session, channel, request),
  });
  const heartbeat = createHeartbeat({
    intervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    misses: options.heartbeatMisses ?? HEARTBEAT_MISSES,
    sendPing: () => multiplexer.control.notify(PING_NOTIFICATION),
    onLost: () => session.stop("heartbeat_lost"),
  });
  const session: Session = {
    input,
    roots,
    guard: createRootGuard(roots),
    processes: createBashProcesses(),
    daemonVersion: options.daemonVersion ?? DAEMON_VERSION,
    multiplexer,
    heartbeat,
    framer: createLineFramer(),
    helloed: false,
    ended: undefined,
    done: signal.promise,
    resolveDone: signal.resolve,
    stop: (reason) => endSession(session, reason),
  };
  // A hub that goes away mid-write ends the session like any other loss.
  output.on("error", () => {
    session.stop("closed");
  });
  heartbeat.start();
  return session;
}
