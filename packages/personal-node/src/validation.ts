import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import { CliError } from "./errors";

/** Wire-JSON and in-process values the Node may serialize. */
export type JsonValue = object | string | number | boolean | null | undefined;

export function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value))
    throw new CliError("invalid_data", `${label} must be an object.`);
  return value;
}

export function text(value: unknown, label: string, max = 20_000): string {
  if (!isString(value))
    throw new CliError(
      "invalid_data",
      `${label} must be a nonempty string (maximum ${max} characters) without NUL bytes.`,
    );
  if (!value.length || Array.from(value).length > max || value.includes("\0")) {
    throw new CliError(
      "invalid_data",
      `${label} must be a nonempty string (maximum ${max} characters) without NUL bytes.`,
    );
  }
  return value;
}

export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!isNumber(value))
    throw new CliError(
      "invalid_data",
      `${label} must be an integer between ${min} and ${max}.`,
    );
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CliError(
      "invalid_data",
      `${label} must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

export function keys(
  value: UnknownRecord,
  allowed: ReadonlyArray<string>,
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new CliError(
      "unknown_field",
      `${label} contains an unsupported field.`,
    );
  }
}

export function uuid(value: unknown): string {
  if (!isString(value))
    throw new CliError(
      "invalid_data",
      "ID must be a nonempty string (maximum 36 characters) without NUL bytes.",
    );
  const id = text(value, "ID", 36);
  if (
    !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      id,
    )
  ) {
    throw new CliError("invalid_id", "Expected a UUID.");
  }
  return id;
}

export function jsonValue(value: unknown): JsonValue {
  if (isString(value)) return value;
  return jsonNonString(value);
}

function jsonNonString(value: unknown): JsonValue {
  if (isNumber(value)) return value;
  return jsonNonNumber(value);
}

function jsonNonNumber(value: unknown): JsonValue {
  if (isBoolean(value)) return value;
  return jsonStructured(value);
}

function jsonStructured(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value === null || value === undefined) return value;
  if (!isRecord(value)) throw new CliError("invalid_json", "Invalid JSON.");
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, jsonValue(field)]),
  );
}

export function parseJson(value: string): JsonValue {
  try {
    return jsonValue(JSON.parse(value));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("invalid_json", "Invalid JSON.");
  }
}

/** Restrict credentials to an explicit authority; never follow redirects. */
export function authority(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("invalid_url", "Expected an absolute HTTPS URL.");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new CliError(
      "insecure_url",
      "HTTPS is required; HTTP is allowed only for literal 127.0.0.1 or [::1].",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%2f|%5c/i.test(url.pathname)
  ) {
    throw new CliError(
      "invalid_url",
      "URL credentials, query, fragment and encoded separators are not allowed.",
    );
  }
  return url.href.replace(/\/+$/, "");
}
