/**
 * One JSON value. `undefined` is allowed inside an object property — the
 * encoder omits such a property, which is how optional result fields travel —
 * but never as a result or a params value itself.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<SerializableValue>
  | { readonly [key: string]: SerializableValue };

/** The encoder's input: `JsonValue` plus the `undefined` a result can carry
 *  inside an object property. */
export type SerializableValue = JsonValue | undefined;

/** A JSON object by the property, for the places that add fields to one. */
export type SerializableRecord = Readonly<Record<string, SerializableValue>>;

export type JsonRpcId = number | string;

/** A request carries an `id` and expects one response on its stream. */
export type JsonRpcRequest = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: JsonValue;
};

/** A notification expects no response; `cancel` and `ping` are notifications. */
export type JsonRpcNotification = {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: JsonValue;
};

export type JsonRpcSuccess = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: JsonValue;
};

export type JsonRpcErrorObject = {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue;
};

export type JsonRpcError = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcErrorObject;
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError;

export function isJsonRpcRequest(
  message: JsonRpcMessage,
): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

export function isJsonRpcNotification(
  message: JsonRpcMessage,
): message is JsonRpcNotification {
  return !("id" in message) && "method" in message;
}

export function isJsonRpcSuccess(
  message: JsonRpcMessage,
): message is JsonRpcSuccess {
  return "id" in message && "result" in message;
}

export function isJsonRpcError(
  message: JsonRpcMessage,
): message is JsonRpcError {
  return "id" in message && "error" in message;
}
