import {
  isBoolean,
  isNumber,
  isString,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import type { JsonValue } from "@workspace/machine-protocol";

/**
 * The MCP SDK's message types carry `unknown` payload slots — a JSON-RPC
 * `result` is `Record<string, unknown>` by construction — so relaying one to
 * the hub needs a narrowing step that is checked rather than asserted. A value
 * the protocol cannot carry is refused with this error instead of travelling
 * as a malformed frame.
 */
export class UnserializableJsonError extends Error {
  constructor() {
    super("The value is not a JSON value.");
    this.name = "UnserializableJsonError";
  }
}

/** Whether JSON can spell this value as a container. */
function isJsonContainer(
  value: unknown,
): value is UnknownRecord | ReadonlyArray<unknown> {
  return value !== null && typeof value === "object";
}

/** A container's members, as JSON values. */
function toJsonContainer(
  value: UnknownRecord | ReadonlyArray<unknown>,
): JsonValue {
  if (Array.isArray(value)) {
    const items: ReadonlyArray<unknown> = value;
    return items.map((item) => toJsonValue(item));
  }
  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    // An absent value is an omitted property in JSON, exactly as the frame
    // encoder treats it.
    if (entry === undefined) continue;
    record[key] = toJsonValue(entry);
  }
  return record;
}

/**
 * The JSON value of an already-parsed value: the four JSON scalar types pass,
 * containers recurse, and a non-finite number is refused because JSON cannot
 * spell it.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (isJsonContainer(value)) return toJsonContainer(value);
  if (value === null || isString(value) || isBoolean(value)) return value;
  if (isNumber(value) && Number.isFinite(value)) return value;
  throw new UnserializableJsonError();
}
