import {
  isIntegerValue,
  isSerializableRecord,
  isStringValue,
  type HelloParams,
  type NativeDisplayOptions,
  type RequestEnvelope,
  type RequestTrace,
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

/**
 * Refuse every key the method does not declare: each git method takes one
 * strict object, and a misspelled key would otherwise be dropped silently.
 */
export function refuseUnknownKeys(
  source: SerializableRecord,
  method: string,
  allowed: ReadonlyArray<string>,
): void {
  const unknown = Object.keys(source).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw invalidParams(method, `Unknown parameter: ${unknown}.`);
  }
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

export function requireBoolean(
  source: SerializableRecord,
  key: string,
  method: string,
): boolean {
  const value = source[key];
  if (value !== true && value !== false)
    throw invalidParams(method, `parameter ${key} must be a boolean`);
  return value;
}

/** A whole, non-negative count, as a budget field is. */
export function requireCount(
  source: SerializableRecord,
  key: string,
  method: string,
): number {
  const value = source[key];
  if (!isIntegerValue(value) || value < 0)
    throw invalidParams(
      method,
      `parameter ${key} must be a whole number of at least 0`,
    );
  return value;
}

export function requireRecord(
  source: SerializableRecord,
  key: string,
  method: string,
): SerializableRecord {
  const value = source[key];
  if (!isSerializableRecord(value))
    throw invalidParams(method, `parameter ${key} must be an object`);
  return value;
}

/** A non-empty bounded list of strings, as a pattern list is. */
export function requireStringList(
  source: SerializableRecord,
  key: string,
  method: string,
  maximum: number,
): ReadonlyArray<string> {
  const value = source[key];
  if (!Array.isArray(value))
    throw invalidParams(method, `parameter ${key} must be an array`);
  const entries: ReadonlyArray<SerializableValue> = value;
  if (entries.length === 0)
    throw invalidParams(method, `parameter ${key} must be a non-empty array`);
  if (entries.length > maximum)
    throw invalidParams(
      method,
      `parameter ${key} may hold at most ${String(maximum)} entries`,
    );
  return entries.map((entry) => {
    if (!isStringValue(entry) || entry.length === 0)
      throw invalidParams(method, `every ${key} entry must be a string`);
    return entry;
  });
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

/** The longest delay `setTimeout` honours (2^31 − 1 ms, about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The hub's trace, when the envelope carries a well-formed one. Tracing is
 * diagnostics, so a malformed trace is dropped rather than refusing the call.
 */
function optionalTrace(envelope: SerializableRecord): RequestTrace | undefined {
  const trace = envelope["trace"];
  if (!isSerializableRecord(trace)) return undefined;
  const sentryTrace = trace["sentryTrace"];
  const baggage = trace["baggage"];
  if (!isStringValue(sentryTrace)) return undefined;
  return { sentryTrace, ...(isStringValue(baggage) && { baggage }) };
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
    // Node's timers overflow past 2^31-1 ms and fire at once; a longer
    // budget is held to the longest timer Node can set.
    budgetMs: Math.min(budgetMs, MAX_TIMER_MS),
    runId: optionalString(envelope, "runId", method),
    attemptId: optionalString(envelope, "attemptId", method),
    toolCallId: optionalString(envelope, "toolCallId", method),
    deliverySeq: optionalInteger(envelope, "deliverySeq", method),
    trace: optionalTrace(envelope),
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
