/**
 * Value interpolation (D4 / spec "Environment-variable interpolation" +
 * "File-path (secret) interpolation" + "Token placement, typing, and
 * escaping"): `{env:NAME}`, `{env:NAME:-default}`, `{path:LOCATION}`, and
 * optional `{path:LOCATION|json:POINTER}` (RFC 6901), single-pass,
 * non-recursive — a resolved value is a literal and is never re-scanned for
 * further tokens. `{{` escapes a literal `{`.
 *
 * This module resolves STRING values only. Whole-value coercion to a
 * non-string schema type happens one layer up, in config-loader.ts, which
 * also knows the config path for error messages — this module never sees it,
 * so it cannot accidentally leak one.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Where an unresolved-but-required token came from — named in errors, never the value. */
export type InterpolationSource =
  | { kind: "env"; name: string }
  | { kind: "path"; location: string };

export class InterpolationError extends Error {
  constructor(
    message: string,
    readonly source: InterpolationSource,
  ) {
    super(message);
    this.name = "InterpolationError";
  }
}

const ENV_TOKEN = /^\{env:([A-Za-z0-9_]+)(?::-([^}]*))?\}/;
const PATH_TOKEN = /^\{path:([^}]*)\}/;
const JSON_POINTER_SEPARATOR = "|json:";

/** Whole-value token grammar shared with the published schema's `interpolationToken` $def. */
export const WHOLE_VALUE_TOKEN_PATTERN =
  /^\{(?:env:[A-Za-z0-9_]+(?::-[^}]*)?|path:[^}]*)\}$/;

/**
 * The one empty `documentLeaves` value. Tokens that read no document share it,
 * so the common `{env:…}` token allocates nothing.
 */
const NO_DOCUMENT_LEAVES: ReadonlyArray<string> = Object.freeze([]);

/**
 * Resolve every `{env:...}` / `{path:...}` token in `input`, left to right.
 * `{{` is consumed as a literal `{` and never considered for token matching.
 * Any other `{` that doesn't start a recognized token is passed through
 * unchanged (there is no other token grammar to mistake it for).
 */
export function interpolateString(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return interpolateStringWithSubstitutions(input, env).value;
}

/**
 * One token's contribution to a resolved string.
 *
 * Empty resolutions are never reported — an empty string matches everywhere
 * and would redact all output.
 */
export type InterpolationSubstitution = Readonly<{
  readonly value: string;
  /** True when the token's `:-` default supplied the value. */
  readonly fallback: boolean;
  /**
   * For a `{path:…|json:…}` token, the selected document's string leaves
   * whose own property name is credential-shaped, read from the same file
   * read that selected the value. Empty for every other token.
   */
  readonly documentLeaves: ReadonlyArray<string>;
}>;

export type InterpolationResult = {
  readonly value: string;
  /**
   * Each token substituted, in order.
   *
   * Callers that treat interpolation as a secret source need the substituted
   * segments, not the finished string: `--auth "Bearer {env:TOKEN}"` should
   * contribute the token, not the whole argument, or a server echoing the bare
   * secret would not be recognized.
   */
  readonly substituted: ReadonlyArray<InterpolationSubstitution>;
};

/**
 * Fragments whose presence in a property name means the value is
 * credential-shaped, case-insensitively. Used to decide which JSON document
 * leaves interpolation reports.
 */
const CREDENTIAL_NAME_FRAGMENTS = [
  "authorization",
  "cookie",
  "credential",
  "token",
  "key",
  "secret",
  "passw",
  "signature",
] as const;

/** A name is credential-shaped when it contains any {@link CREDENTIAL_NAME_FRAGMENTS}. */
export function isCredentialName(name: string): boolean {
  const folded = name.toLowerCase();
  return CREDENTIAL_NAME_FRAGMENTS.some((fragment) =>
    folded.includes(fragment),
  );
}

/**
 * As {@link interpolateString}, but also reports what each token resolved to.
 */
export function interpolateStringWithSubstitutions(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): InterpolationResult {
  const substituted: Array<InterpolationSubstitution> = [];
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "{") {
      out += input[i];
      i += 1;
      continue;
    }

    if (input[i + 1] === "{") {
      out += "{";
      i += 2;
      continue;
    }

    const rest = input.slice(i);

    const envMatch = matchEnvToken(rest, env);
    if (envMatch) {
      out = appendSubstitution(out, envMatch, substituted);
      i += envMatch.length;
      continue;
    }

    const pathMatch = matchPathToken(rest);
    if (pathMatch) {
      out = appendSubstitution(out, pathMatch, substituted);
      i += pathMatch.length;
      continue;
    }

    out += input[i];
    i += 1;
  }
  return { value: out, substituted };
}

function appendSubstitution(
  out: string,
  match: TokenMatch,
  substituted: Array<InterpolationSubstitution>,
): string {
  if (match.resolved.length > 0) {
    substituted.push({
      value: match.resolved,
      fallback: match.fallback,
      documentLeaves: match.documentLeaves,
    });
  }
  return out + match.resolved;
}

/** A token match's resolved replacement text and the source length it consumed. */
type TokenMatch = {
  readonly resolved: string;
  readonly length: number;
  readonly fallback: boolean;
  readonly documentLeaves: ReadonlyArray<string>;
};

function matchEnvToken(
  rest: string,
  env: NodeJS.ProcessEnv,
): TokenMatch | undefined {
  const envMatch = ENV_TOKEN.exec(rest);
  if (!envMatch) return undefined;
  const [full, name, fallback] = envMatch;
  const resolved = resolveEnvToken(name, fallback, env);
  return {
    resolved: resolved.value,
    length: full.length,
    fallback: resolved.fallback,
    documentLeaves: NO_DOCUMENT_LEAVES,
  };
}

function matchPathToken(rest: string): TokenMatch | undefined {
  const pathMatch = PATH_TOKEN.exec(rest);
  if (!pathMatch) return undefined;
  const [full, location] = pathMatch;
  const resolved = resolvePathToken(location);
  return {
    resolved: resolved.value,
    length: full.length,
    fallback: false,
    documentLeaves: resolved.documentLeaves,
  };
}

/** A `{env:…}` token's resolved text and whether its `:-` default supplied it. */
type EnvResolution = { readonly value: string; readonly fallback: boolean };

function resolveEnvToken(
  name: string,
  fallback: string | undefined,
  env: NodeJS.ProcessEnv,
): EnvResolution {
  const value = env[name];
  if (fallback !== undefined) {
    // Bash/docker-compose `:-` semantics (D4): the fallback applies when the
    // variable is unset OR empty — that is precisely what distinguishes `:-`
    // from `-`. A blank env var must not shadow the declared default.
    const usedFallback = value === undefined || value === "";
    return { value: usedFallback ? fallback : value, fallback: usedFallback };
  }
  if (value !== undefined) {
    return { value, fallback: false };
  }
  throw new InterpolationError(
    `required environment variable ${name} is not set`,
    { kind: "env", name },
  );
}

/** A `{path:…}` token's value and, for `|json:`, the credential leaves of its document. */
type PathResolution = {
  readonly value: string;
  readonly documentLeaves: ReadonlyArray<string>;
};

/**
 * {path:...} reads any file the process can read, by design: the config file
 * is operator-authored deploy-time input — the same trust level as the
 * process environment itself — so there is no path-traversal boundary to
 * enforce here (an allowlist would break legitimate secret mounts outside
 * /run/secrets). Tenants can never write this file.
 *
 * Optional `|json:POINTER` (RFC 6901) parses the file as JSON and selects a
 * string. A path containing the literal `|json:` substring is unsupported.
 */
function resolvePathToken(location: string): PathResolution {
  const separatorAt = location.indexOf(JSON_POINTER_SEPARATOR);
  const filePath =
    separatorAt === -1 ? location : location.slice(0, separatorAt);
  const pointer =
    separatorAt === -1
      ? undefined
      : location.slice(separatorAt + JSON_POINTER_SEPARATOR.length);

  const payload = readSecretFile(filePath);
  if (pointer === undefined) {
    return { value: payload.trim(), documentLeaves: [] };
  }
  return selectJsonPointerFromPayload(payload, pointer, filePath);
}

function readSecretFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    // The fs error names the path and errno only — never file contents.
    const detail = error instanceof Error ? error.message : String(error);
    throw new InterpolationError(
      `required file ${filePath} could not be read: ${detail}`,
      { kind: "path", location: filePath },
    );
  }
}

function selectJsonPointerFromPayload(
  payload: string,
  pointer: string,
  filePath: string,
): PathResolution {
  let document: JsonValue;
  try {
    // SAFETY: JSON.parse returns `any`; unknown is the I/O-boundary type that
    // parseJsonValue validates into JsonValue.
    const parsed = JSON.parse(payload) as unknown;
    document = parseJsonValue(parsed);
  } catch (error) {
    if (error instanceof InterpolationError) throw error;
    throw new InterpolationError(
      `required file ${filePath} is not valid JSON`,
      { kind: "path", location: filePath },
    );
  }

  let selected: JsonValue;
  try {
    selected = selectJsonPointer(document, pointer);
  } catch {
    throw new InterpolationError(
      `JSON pointer did not select a value in ${filePath}`,
      { kind: "path", location: filePath },
    );
  }

  if (!isJsonString(selected)) {
    throw new InterpolationError(
      `JSON pointer must select a string in ${filePath}`,
      { kind: "path", location: filePath },
    );
  }
  // Both come from the one parse above: the set can never mix two versions of
  // the file, even if it rotates between reads.
  return {
    value: selected,
    documentLeaves: credentialDocumentLeaves(document),
  };
}

/**
 * The string leaves of a selected document whose own property name is
 * credential-shaped, or that sit in an array under such a name.
 */
function credentialDocumentLeaves(document: JsonValue): ReadonlyArray<string> {
  const leaves: Array<string> = [];
  collectLeaves(document, false, leaves);
  return leaves;
}

/**
 * One walk of the selected document. A string is a leaf when the property name
 * directly above it is credential-shaped, or when it is an array element under
 * such a name (carried down through nested arrays). An object's own child
 * names decide for their children, so `tokens.note` does not inherit
 * `tokens`.
 */
function collectLeaves(
  value: JsonValue,
  underCredentialName: boolean,
  leaves: Array<string>,
): void {
  if (isJsonString(value)) {
    if (underCredentialName) pushCredentialLeaf(value, leaves);
    return;
  }
  if (isJsonArray(value)) {
    for (const item of value) {
      collectLeaves(item, underCredentialName, leaves);
    }
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectLeaves(child, isCredentialName(key), leaves);
  }
}

function pushCredentialLeaf(value: string, leaves: Array<string>): void {
  // A blank leaf carries no secret, and trimming it would turn whitespace
  // into a member that redacts unrelated text.
  if (value.trim().length === 0) return;
  leaves.push(value);
}

/** Parsed JSON tree for secret-file pointer selection. */
type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | JsonObject;

// eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- package-local UnknownRecord: the one owned Record<string, unknown> declaration for JSON.parse boundaries; consumers use JsonValue / JsonObject after parseJsonValue.
type UnknownRecord = Record<string, unknown>;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonString(value: JsonValue): value is string {
  return typeof value === "string";
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is ReadonlyArray<JsonValue> {
  return Array.isArray(value);
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- this function IS the JSON I/O-boundary parser: first uses are `isString`/`isNumber`/`isBoolean`/`Array.isArray`/`isRecord` guards over `raw`, but the null short-circuit must run first and the exemption only recognizes an isXxx call as the first statement.
function parseJsonValue(raw: unknown): JsonValue {
  if (raw === null) return null;
  if (isString(raw)) return raw;
  if (isNumber(raw)) return raw;
  if (isBoolean(raw)) return raw;
  if (Array.isArray(raw)) {
    return raw.map((item) => parseJsonValue(item));
  }
  if (isRecord(raw)) {
    const entries: { [key: string]: JsonValue } = {};
    for (const entry of Object.entries(raw)) {
      const key = entry[0];
      const value: unknown = entry[1];
      // defineProperty — not assignment — so a JSON member named `__proto__`
      // becomes an own property. `entries[key] = …` would hit Object.prototype's
      // setter and drop the key, breaking RFC 6901 selection of that member.
      Object.defineProperty(entries, key, {
        value: parseJsonValue(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return entries;
  }
  throw new Error("unsupported JSON value");
}

function decodePointerToken(token: string): string {
  let out = "";
  for (let i = 0; i < token.length; i += 1) {
    if (token[i] !== "~") {
      out += token[i];
      continue;
    }
    const escape = token[i + 1];
    if (escape !== "0" && escape !== "1") {
      throw new Error("invalid JSON pointer escape");
    }
    out += escape === "0" ? "~" : "/";
    i += 1;
  }
  return out;
}

function selectJsonPointer(document: JsonValue, pointer: string): JsonValue {
  if (pointer === "") {
    return document;
  }
  if (!pointer.startsWith("/")) {
    throw new Error("JSON pointer must be empty or start with '/'");
  }
  let current: JsonValue = document;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodePointerToken(rawToken);
    if (isJsonObject(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new Error("missing property");
      }
      current = current[token];
      continue;
    }
    if (isJsonArray(current)) {
      if (token !== "0" && (!/^\d+$/.test(token) || token.startsWith("0"))) {
        throw new Error("invalid array index");
      }
      const index = Number(token);
      if (index >= current.length) {
        throw new Error("array index out of range");
      }
      const next = current[index];
      if (next === undefined) {
        throw new Error("array index out of range");
      }
      current = next;
      continue;
    }
    throw new Error("cannot traverse value");
  }

  return current;
}
/** Workspace interpolation is single-pass and does not unescape doubled braces. */
export type WorkspaceInterpolationSubstitution = Readonly<{
  value: string;
  fallback: boolean;
}>;

export type WorkspaceInterpolationResult = Readonly<{
  value: string;
  substitutions: ReadonlyArray<WorkspaceInterpolationSubstitution>;
}>;

type WorkspaceToken = {
  value: string;
  length: number;
  substitution?: WorkspaceInterpolationSubstitution;
};

const WORKSPACE_ENV_NAME = /^[A-Za-z0-9_]+$/u;

export async function interpolateWorkspaceString(
  input: string,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceInterpolationResult> {
  let value = "";
  const substitutions: Array<WorkspaceInterpolationSubstitution> = [];
  let index = 0;
  while (index < input.length) {
    const token = await workspaceToken(input, index, root, env);
    if (token === undefined) {
      value += input[index];
      index += 1;
      continue;
    }
    value += token.value;
    if (token.substitution !== undefined)
      substitutions.push(token.substitution);
    index += token.length;
  }
  return { value, substitutions };
}

async function workspaceToken(
  input: string,
  index: number,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<WorkspaceToken | undefined> {
  const dollar = input.startsWith("${", index);
  const envPrefix = input.startsWith("{env:", index);
  const pathPrefix = input.startsWith("{path:", index);
  if (!dollar && !envPrefix && !pathPrefix) return undefined;
  const prefixLength = dollar ? 2 : pathPrefix ? 6 : 5;
  const close = input.indexOf("}", index + prefixLength);
  if (close === -1) return undefined;
  const body = input.slice(index + prefixLength, close);
  if (pathPrefix) {
    const value = await workspacePath(body, root);
    return workspaceTokenResult(value, close - index + 1, false);
  }
  const parsed = workspaceEnvBody(body);
  if (parsed === undefined) return undefined;
  const value = Object.hasOwn(env, parsed.name) ? env[parsed.name] : undefined;
  const useFallback =
    value === undefined || (value === "" && parsed.fallback !== undefined);
  if (useFallback && parsed.fallback === undefined) {
    throw new InterpolationError(
      `required environment variable ${parsed.name} is not set`,
      { kind: "env", name: parsed.name },
    );
  }
  const resolved = useFallback ? (parsed.fallback ?? "") : (value ?? "");
  return workspaceTokenResult(resolved, close - index + 1, useFallback);
}

function workspaceTokenResult(
  value: string,
  length: number,
  fallback: boolean,
): WorkspaceToken {
  const result: WorkspaceToken = { value, length };
  if (value.length > 0) result.substitution = { value, fallback };
  return result;
}

type WorkspaceEnvBody = { name: string; fallback?: string };

function workspaceEnvBody(body: string): WorkspaceEnvBody | undefined {
  const separator = body.indexOf(":-");
  const name = separator === -1 ? body : body.slice(0, separator);
  if (!WORKSPACE_ENV_NAME.test(name)) return undefined;
  const result: WorkspaceEnvBody = { name };
  if (separator !== -1) result.fallback = body.slice(separator + 2);
  return result;
}

async function workspacePath(location: string, root: string): Promise<string> {
  if (location.length === 0) {
    throw new InterpolationError("required file location is empty", {
      kind: "path",
      location,
    });
  }
  const file = path.isAbsolute(location)
    ? location
    : path.resolve(root, location);
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    throw new InterpolationError(
      `required file ${location} could not be read`,
      { kind: "path", location },
    );
  }
}
