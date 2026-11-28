/** JSON values used by MCP payloads and the API-facing result shapes. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue | undefined };

/** JSON-RPC-independent serialization helpers retained for API validators. */
export type SerializableValue = JsonValue | undefined;

export type SerializableRecord = Readonly<Record<string, SerializableValue>>;
