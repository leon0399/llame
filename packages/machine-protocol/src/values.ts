import type { SerializableRecord, SerializableValue } from "./json-types";

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
