import { MAX_MESSAGE_BYTES } from "./constants";
import {
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcSuccess,
  type SerializableRecord,
  type SerializableValue,
} from "./json-rpc";
import {
  isIdValue,
  isIntegerValue,
  isSerializableRecord,
  isStringValue,
} from "./values";

/** One stream's message. The `{"s":…,"m":…}` wrapper sits outside the size
 *  bound, which applies to the serialized `m` alone. */
export type Frame = { readonly s: number; readonly m: JsonRpcMessage };

export type FrameDecodeResult =
  | { readonly ok: true; readonly frame: Frame }
  | {
      readonly ok: false;
      readonly reason: "malformed";
      /** Present once the wrapper named a stream, so it can be refused. */
      readonly streamId?: number;
    }
  | {
      readonly ok: false;
      readonly reason: "oversize";
      readonly streamId: number;
    };

/** The sender's refusal: this message may not go on the wire at all. */
export class FrameSizeError extends Error {
  constructor(readonly byteSize: number) {
    super(
      `A frame message of ${byteSize} bytes exceeds the ${MAX_MESSAGE_BYTES} byte bound.`,
    );
    this.name = "FrameSizeError";
  }
}

export function encodeFrame(frame: Frame): string {
  const message = JSON.stringify(frame.m);
  const byteSize = Buffer.byteLength(message, "utf8");
  if (byteSize > MAX_MESSAGE_BYTES) throw new FrameSizeError(byteSize);
  return `${JSON.stringify(frame)}\n`;
}

function parseJsonObject(line: string): SerializableRecord | undefined {
  try {
    // SAFETY: JSON.parse returns `any`; the unknown boundary type forces the
    // shape check below before any property is read.
    const parsed = JSON.parse(line) as unknown;
    return isSerializableRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toError(
  record: SerializableRecord,
  error: SerializableValue,
): JsonRpcError | undefined {
  if (!isSerializableRecord(error)) return undefined;
  const code = error["code"];
  const message = error["message"];
  if (!isIntegerValue(code) || !isStringValue(message)) return undefined;
  const raw = record["id"];
  const id = raw === null || raw === undefined ? null : raw;
  if (id !== null && !isIdValue(id)) return undefined;
  const data = error["data"];
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function toCall(
  record: SerializableRecord,
  method: string,
): JsonRpcMessage | undefined {
  const params = record["params"];
  const raw = record["id"];
  if (raw === undefined)
    return params === undefined
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", method, params };
  if (!isIdValue(raw)) return undefined;
  return params === undefined
    ? { jsonrpc: "2.0", id: raw, method }
    : { jsonrpc: "2.0", id: raw, method, params };
}

function toSuccess(record: SerializableRecord): JsonRpcSuccess | undefined {
  const id = record["id"];
  const result = record["result"];
  if (!isIdValue(id) || result === undefined) return undefined;
  return { jsonrpc: "2.0", id, result };
}

/** The message a decoded value carries, or undefined for any other shape. */
export function toJsonRpcMessage(
  value: SerializableValue,
): JsonRpcMessage | undefined {
  if (!isSerializableRecord(value) || value["jsonrpc"] !== "2.0")
    return undefined;
  const error = value["error"];
  if (error !== undefined) return toError(value, error);
  const method = value["method"];
  if (method !== undefined)
    return isStringValue(method) && value["result"] === undefined
      ? toCall(value, method)
      : undefined;
  return toSuccess(value);
}

/**
 * The frame a line carries. A line inside the wrapper bound whose message
 * alone exceeds the message bound is `oversize` with the stream it named, so
 * the receiver closes exactly that stream; every other unusable line is
 * `malformed`.
 */
export function decodeFrame(line: string): FrameDecodeResult {
  const parsed = parseJsonObject(line);
  if (parsed === undefined) return { ok: false, reason: "malformed" };
  const stream = parsed["s"];
  const message = parsed["m"];
  if (!isIntegerValue(stream) || stream < 0)
    return { ok: false, reason: "malformed" };
  if (message === undefined)
    return { ok: false, reason: "malformed", streamId: stream };
  const serialized = JSON.stringify(message);
  if (
    serialized !== undefined &&
    Buffer.byteLength(serialized, "utf8") > MAX_MESSAGE_BYTES
  )
    return { ok: false, reason: "oversize", streamId: stream };
  const decoded = toJsonRpcMessage(message);
  return decoded === undefined
    ? { ok: false, reason: "malformed", streamId: stream }
    : { ok: true, frame: { s: stream, m: decoded } };
}
