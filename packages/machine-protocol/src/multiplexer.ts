import { CONTROL_STREAM_ID, MAX_CONCURRENT_STREAMS } from "./constants";
import { isMachineErrorCode, MACHINE_ERROR_JSON_RPC } from "./errors";
import type { MachineErrorCode } from "./errors";
import type { Frame } from "./frame";
import type {
  JsonRpcError,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonValue,
  SerializableRecord,
} from "./json-rpc";
import { CANCEL_NOTIFICATION } from "./methods";
import type { MachineMethod, MachineMethodParams } from "./types";
import { isSerializableRecord, isStringValue } from "./values";

/** A remote JSON-RPC error, with the Machine's own code lifted out of `data`. */
export class MachineProtocolError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
    readonly data?: JsonValue,
  ) {
    super(message);
    this.name = "MachineProtocolError";
  }
}

/** The stream ended before it produced the answer the caller awaits. */
export class StreamClosedError extends Error {
  constructor(
    readonly streamId: number,
    readonly reason: "closed" | "cancelled",
  ) {
    super(`Stream ${streamId} was ${reason}.`);
    this.name = "StreamClosedError";
  }
}

export type ChannelRequestOptions = { readonly signal?: AbortSignal };

/**
 * One session stream. The hub opens streams and sends one request on each;
 * the daemon answers on the stream it arrived on. Neither side closes a stream
 * implicitly — the caller closes it once the method's exchange is over, and a
 * frame for a closed stream is dropped by the multiplexer.
 *
 * `request` resolves the decoded JSON of the method's result. A Machine is
 * untrusted input, so the caller narrows that value against the method's
 * `MachineMethodResults` entry (or validates it) before use.
 */
export type MachineChannel = {
  readonly id: number;
  readonly closed: boolean;
  /** Aborts when the peer cancels this stream or the session ends. */
  readonly signal: AbortSignal;
  request<M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options?: ChannelRequestOptions,
  ): Promise<JsonValue>;
  notify(method: string, params?: JsonValue): void;
  result(value: JsonValue): void;
  error(
    code: MachineErrorCode,
    message: string,
    data?: SerializableRecord,
  ): void;
  onNotification(handler: (message: JsonRpcNotification) => void): void;
  onClose(handler: () => void): void;
  close(): void;
};

export type FrameMultiplexerOptions = {
  /** Put one encoded frame on the wire; a closed session drops instead. */
  readonly send: (frame: Frame) => void;
  /** A request opened a numbered stream (or arrived on control). */
  readonly onRequest?: (
    channel: MachineChannel,
    request: JsonRpcRequest,
  ) => void;
  /** A frame for an unknown, closed, or unusable stream. */
  readonly onUnknownFrame?: (frame: Frame) => void;
  readonly maxOpenStreams?: number;
};

export type FrameMultiplexer = {
  readonly control: MachineChannel;
  readonly openStreams: number;
  open(): MachineChannel;
  handle(frame: Frame): void;
  /**
   * Refuse the stream an unusable inbound frame named, which is how an
   * oversize or malformed message becomes a protocol error on its own stream
   * instead of silence. An unknown or closed stream is dropped.
   */
  refuseStream(streamId: number, code: MachineErrorCode, message: string): void;
  close(): void;
};

type PendingRequest = {
  readonly id: JsonRpcId;
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly detach: () => void;
};

type StreamState = {
  readonly id: number;
  readonly control: boolean;
  readonly controller: AbortController;
  readonly notifications: Array<(message: JsonRpcNotification) => void>;
  readonly closes: Array<() => void>;
  closed: boolean;
  /** The id a response must echo; unset while the stream carries no request. */
  replyId: JsonRpcId | undefined;
  pending: PendingRequest | undefined;
};

type StreamSession = {
  readonly send: (frame: Frame) => void;
  readonly onRequest: FrameMultiplexerOptions["onRequest"];
  readonly onUnknownFrame: FrameMultiplexerOptions["onUnknownFrame"];
  readonly maxOpenStreams: number;
  readonly streams: Map<number, StreamState>;
  readonly closedIds: Set<number>;
  readonly control: StreamState;
  nextId: number;
  closed: boolean;
};

function newState(id: number, control: boolean): StreamState {
  return {
    id,
    control,
    controller: new AbortController(),
    notifications: [],
    closes: [],
    closed: false,
    replyId: undefined,
    pending: undefined,
  };
}

function errorMessage(
  id: JsonRpcId,
  code: MachineErrorCode,
  message: string,
  data: SerializableRecord = {},
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: MACHINE_ERROR_JSON_RPC[code],
      message,
      data: { ...data, code },
    },
  };
}

function protocolError(error: JsonRpcError): MachineProtocolError {
  const data = isSerializableRecord(error.error.data)
    ? error.error.data
    : undefined;
  const code = data === undefined ? undefined : data["code"];
  return new MachineProtocolError(
    isStringValue(code) && isMachineErrorCode(code) ? code : "internal",
    error.error.message,
    error.error.data,
  );
}

function closeStream(
  session: StreamSession,
  state: StreamState,
  reason: "closed" | "cancelled",
): void {
  if (state.closed) return;
  state.closed = true;
  state.controller.abort();
  if (!state.control) {
    session.streams.delete(state.id);
    session.closedIds.add(state.id);
  }
  const pending = state.pending;
  state.pending = undefined;
  if (pending !== undefined) {
    pending.detach();
    pending.reject(new StreamClosedError(state.id, reason));
  }
  state.closes.forEach((handler) => handler());
}

function settleStream(state: StreamState, message: JsonRpcMessage): void {
  const pending = state.pending;
  const id = "id" in message ? message.id : undefined;
  if (pending === undefined || id !== pending.id) return;
  state.pending = undefined;
  pending.detach();
  if ("result" in message) pending.resolve(message.result);
  else if ("error" in message) pending.reject(protocolError(message));
}

function receiveMessage(
  session: StreamSession,
  state: StreamState,
  message: JsonRpcMessage,
): void {
  if ("method" in message) {
    if (message.method === CANCEL_NOTIFICATION) {
      closeStream(session, state, "cancelled");
      return;
    }
    if (!("id" in message)) {
      state.notifications.forEach((handler) => handler(message));
      return;
    }
    // The control stream carries the handshake and keeps accepting requests;
    // a numbered stream carries exactly the one that opened it.
    if (state.control && session.onRequest !== undefined) {
      state.replyId = message.id;
      session.onRequest(streamChannel(session, state), message);
    }
    return;
  }
  settleStream(state, message);
}

function acceptRequest(
  session: StreamSession,
  id: number,
  request: JsonRpcRequest,
): void {
  const state = newState(id, false);
  state.replyId = request.id;
  session.streams.set(id, state);
  session.onRequest?.(streamChannel(session, state), request);
}

function handleFrame(session: StreamSession, frame: Frame): void {
  if (session.closed) return;
  const open = session.streams.get(frame.s);
  if (open !== undefined) {
    receiveMessage(session, open, frame.m);
    return;
  }
  if (frame.s === CONTROL_STREAM_ID) {
    receiveMessage(session, session.control, frame.m);
    return;
  }
  if (
    session.closedIds.has(frame.s) ||
    session.onRequest === undefined ||
    !("method" in frame.m) ||
    !("id" in frame.m)
  ) {
    session.onUnknownFrame?.(frame);
    return;
  }
  if (session.streams.size >= session.maxOpenStreams) {
    session.closedIds.add(frame.s);
    session.send({
      s: frame.s,
      m: errorMessage(
        frame.m.id,
        "internal",
        "The session already carries the maximum number of streams.",
      ),
    });
    return;
  }
  acceptRequest(session, frame.s, frame.m);
}

function sendOnStream(
  session: StreamSession,
  state: StreamState,
  message: JsonRpcMessage,
): void {
  if (state.closed) return;
  session.send({ s: state.id, m: message });
}

function notifyOnStream(
  session: StreamSession,
  state: StreamState,
  method: string,
  params?: JsonValue,
): void {
  sendOnStream(
    session,
    state,
    params === undefined
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", method, params },
  );
}

function respondOnStream(
  session: StreamSession,
  state: StreamState,
  build: (id: JsonRpcId) => JsonRpcMessage,
): void {
  const id = state.replyId;
  if (id === undefined) return;
  sendOnStream(session, state, build(id));
}

function abortLink(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): () => void {
  if (signal === undefined) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function requestOnStream<M extends MachineMethod>(
  session: StreamSession,
  state: StreamState,
  call: {
    readonly method: M;
    readonly params: MachineMethodParams[M];
    readonly options?: ChannelRequestOptions;
  },
): Promise<JsonValue> {
  if (state.closed || session.closed)
    return Promise.reject(new StreamClosedError(state.id, "closed"));
  if (state.replyId !== undefined)
    return Promise.reject(
      new Error(`Stream ${state.id} already carries a request.`),
    );
  state.replyId = state.id;
  return new Promise<JsonValue>((resolve, reject) => {
    const detach = abortLink(call.options?.signal, () => {
      notifyOnStream(session, state, CANCEL_NOTIFICATION);
      closeStream(session, state, "cancelled");
    });
    state.pending = { id: state.id, resolve, reject, detach };
    try {
      sendOnStream(session, state, {
        jsonrpc: "2.0",
        id: state.id,
        method: call.method,
        params: call.params,
      });
    } catch (error) {
      // The sender refused the message (it was oversize), so nothing reached
      // the wire and the call fails here.
      state.replyId = undefined;
      state.pending = undefined;
      detach();
      reject(error instanceof Error ? error : new Error("Frame rejected."));
    }
  });
}

function streamChannel(
  session: StreamSession,
  state: StreamState,
): MachineChannel {
  return {
    get id() {
      return state.id;
    },
    get closed() {
      return state.closed;
    },
    get signal() {
      return state.controller.signal;
    },
    request: (method, params, options) =>
      requestOnStream(session, state, { method, params, options }),
    notify: (method, params) => notifyOnStream(session, state, method, params),
    result: (value) =>
      respondOnStream(session, state, (id) => ({
        jsonrpc: "2.0",
        id,
        result: value,
      })),
    error: (code, message, data) =>
      respondOnStream(session, state, (id) =>
        errorMessage(id, code, message, data),
      ),
    onNotification: (handler) => {
      state.notifications.push(handler);
    },
    onClose: (handler) => {
      state.closes.push(handler);
    },
    close: () => {
      if (!state.control) closeStream(session, state, "closed");
    },
  };
}

function openStream(session: StreamSession): MachineChannel {
  if (session.closed) throw new Error("The Machine session is closed.");
  if (session.streams.size >= session.maxOpenStreams)
    throw new Error(
      "The Machine session already carries the maximum number of streams.",
    );
  const state = newState(session.nextId, false);
  // Ids only grow, so a closed stream's id is never handed out again.
  session.nextId += 1;
  session.streams.set(state.id, state);
  return streamChannel(session, state);
}

function refuseStream(
  session: StreamSession,
  streamId: number,
  code: MachineErrorCode,
  message: string,
): void {
  const state =
    streamId === CONTROL_STREAM_ID
      ? session.control
      : session.streams.get(streamId);
  if (state === undefined || state.closed) return;
  session.send({
    s: streamId,
    m: errorMessage(state.replyId ?? streamId, code, message),
  });
  if (!state.control) closeStream(session, state, "closed");
}

function closeSession(session: StreamSession): void {
  session.closed = true;
  // Closing removes exactly the entry the loop is on, so iterating the live
  // map visits every open stream once.
  for (const state of session.streams.values())
    closeStream(session, state, "closed");
  closeStream(session, session.control, "closed");
}

export function createFrameMultiplexer(
  options: FrameMultiplexerOptions,
): FrameMultiplexer {
  const session: StreamSession = {
    send: options.send,
    onRequest: options.onRequest,
    onUnknownFrame: options.onUnknownFrame,
    maxOpenStreams: options.maxOpenStreams ?? MAX_CONCURRENT_STREAMS,
    streams: new Map(),
    closedIds: new Set(),
    control: newState(CONTROL_STREAM_ID, true),
    nextId: 1,
    closed: false,
  };
  return {
    control: streamChannel(session, session.control),
    get openStreams() {
      return session.streams.size;
    },
    open: () => openStream(session),
    handle: (frame) => handleFrame(session, frame),
    refuseStream: (streamId, code, message) =>
      refuseStream(session, streamId, code, message),
    close: () => closeSession(session),
  };
}
