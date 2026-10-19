import {
  isIntegerValue,
  isSerializableRecord,
  isStringValue,
  type HelloParams,
  type NativeDisplayOptions,
  type RequestEnvelope,
  type SerializableRecord,
  type SerializableValue,
} from "@workspace/machine-protocol";
import { invalidParams } from "./errors";

/**
 * Request parameters are untrusted input: every field is read here, once,
 * through a check that either produces the declared type or refuses the
 * request as `invalid_params`.
 */
export function paramRecord(
  value: SerializableValue,
  method: string,
): SerializableRecord {
  if (!isSerializableRecord(value))
    throw invalidParams(method, "the request carries no parameters");
  return value;
}

export function requireString(
  source: SerializableRecord,
  key: string,
  method: string,
): string {
  const value = source[key];
  if (!isStringValue(value))
    throw invalidParams(method, `parameter ${key} must be a string`);
  return value;
}

export function optionalString(
  source: SerializableRecord,
  key: string,
  method: string,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isStringValue(value))
    throw invalidParams(method, `parameter ${key} must be a string`);
  return value;
}

export function optionalInteger(
  source: SerializableRecord,
  key: string,
  method: string,
  minimum = 0,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isIntegerValue(value) || value < minimum)
    throw invalidParams(
      method,
      `parameter ${key} must be a whole number of at least ${String(minimum)}`,
    );
  return value;
}

export function optionalBoolean(
  source: SerializableRecord,
  key: string,
  method: string,
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (value !== true && value !== false)
    throw invalidParams(method, `parameter ${key} must be a boolean`);
  return value;
}

/** The additive environment of a `bash` call; the managed base is not here. */
export function optionalEnvironment(
  source: SerializableRecord,
  method: string,
): Record<string, string> | undefined {
  const value = source["env"];
  if (value === undefined) return undefined;
  if (!isSerializableRecord(value))
    throw invalidParams(method, "parameter env must be an object of strings");
  const environment: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isStringValue(entry))
      throw invalidParams(method, `environment value ${name} must be a string`);
    environment[name] = entry;
  }
  return environment;
}

export function readEnvelope(
  value: SerializableValue,
  method: string,
): RequestEnvelope {
  const record = paramRecord(value, method);
  const envelope = record["envelope"];
  if (!isSerializableRecord(envelope))
    throw invalidParams(method, "the request carries no envelope");
  const budgetMs = envelope["budgetMs"];
  if (!isIntegerValue(budgetMs))
    throw invalidParams(
      method,
      "the envelope budget must be whole milliseconds",
    );
  return {
    budgetMs,
    runId: optionalString(envelope, "runId", method),
    attemptId: optionalString(envelope, "attemptId", method),
    toolCallId: optionalString(envelope, "toolCallId", method),
    deliverySeq: optionalInteger(envelope, "deliverySeq", method),
  };
}

/** The `machine://<name>` prefix the hub renders results under. */
export function requireDisplayOptions(
  source: SerializableRecord,
  method: string,
): NativeDisplayOptions {
  const value = source["options"];
  if (!isSerializableRecord(value))
    throw invalidParams(method, "the request carries no display options");
  const displayPrefix = requireString(value, "displayPrefix", method);
  if (displayPrefix.length === 0 || /\s/u.test(displayPrefix))
    throw invalidParams(method, "the display prefix must be a non-empty token");
  return {
    displayPrefix: displayPrefix.endsWith("/")
      ? displayPrefix.slice(0, -1)
      : displayPrefix,
    selector: optionalString(value, "selector", method),
    reserveCodeUnits: optionalInteger(value, "reserveCodeUnits", method),
  };
}

export function readHelloParams(value: SerializableValue): HelloParams {
  const record = paramRecord(value, "hello");
  const protocolVersion = record["protocolVersion"];
  if (!isIntegerValue(protocolVersion))
    throw invalidParams("hello", "protocolVersion must be a whole number");
  return {
    protocolVersion,
    hubVersion: requireString(record, "hubVersion", "hello"),
  };
}
