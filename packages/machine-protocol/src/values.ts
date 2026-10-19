import type { SerializableRecord, SerializableValue } from "./json-rpc";

/** Whether a parsed value is a JSON object; a JSON array is not one. */
export function isSerializableRecord(
  value: unknown,
): value is SerializableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringValue(value: SerializableValue): value is string {
  return typeof value === "string";
}

export function isIntegerValue(value: SerializableValue): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A JSON-RPC id: a whole number or a string. */
export function isIdValue(value: SerializableValue): value is number | string {
  return isStringValue(value) || isIntegerValue(value);
}
