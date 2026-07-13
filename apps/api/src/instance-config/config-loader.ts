import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';

import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
  type WorkerProfile,
} from './llame-config';
import { InstanceConfigError } from './instance-config.error';
import { getConfigValidator } from './schema';
import { InterpolationError, interpolateString } from './interpolation';
import { getRegisteredToolIds } from '../tools/registry';

const DEFAULT_CONFIG_FILENAME = 'llame.config.json';

/** Default `llame.config.json` in the API runtime cwd; `LLAME_CONFIG_PATH` overrides (D1). */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.LLAME_CONFIG_PATH?.trim();
  return path.resolve(
    process.cwd(),
    override && override.length > 0 ? override : DEFAULT_CONFIG_FILENAME,
  );
}

/** Load, validate, interpolate, and apply file > built-in-default precedence (the environment reaches config only via {env:...} tokens in the file). Throws InstanceConfigError on any failure — the only correct response is to abort boot (D6). */
export function loadInstanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlameConfig {
  const configPath = resolveConfigPath(env);
  const raw = readRawConfig(configPath);
  if (raw !== undefined) {
    assertValidRaw(raw, configPath);
  }

  return {
    defaults: {
      modelId: resolveNullableString({
        configPath: 'defaults.modelId',
        ...readLeaf(raw, 'defaults', 'modelId'),
        env,
      }),
      titleGenerationModelId: resolveNullableString({
        configPath: 'defaults.titleGenerationModelId',
        ...readLeaf(raw, 'defaults', 'titleGenerationModelId'),
        env,
      }),
    },
    runs: {
      maxOutputTokens: resolveNumeric({
        configPath: 'runs.maxOutputTokens',
        ...readLeaf(raw, 'runs', 'maxOutputTokens'),
        builtInDefault: BUILT_IN_DEFAULTS.runs.maxOutputTokens,
        nullable: true,
        env,
      }),
      // nullable:false guarantees a number, never null — see resolveNumeric.
      heartbeatSeconds: resolveNumeric({
        configPath: 'runs.heartbeatSeconds',
        ...readLeaf(raw, 'runs', 'heartbeatSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.runs.heartbeatSeconds,
        nullable: false,
        env,
      }) as number,
      timeoutSeconds: resolveNumeric({
        configPath: 'runs.timeoutSeconds',
        ...readLeaf(raw, 'runs', 'timeoutSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.runs.timeoutSeconds,
        nullable: false,
        env,
      }) as number,
    },
    http: {
      trustProxy: resolveNullableString({
        configPath: 'http.trustProxy',
        ...readLeaf(raw, 'http', 'trustProxy'),
        env,
      }),
    },
    db: {
      poolSize: resolveNumeric({
        configPath: 'db.poolSize',
        ...readLeaf(raw, 'db', 'poolSize'),
        builtInDefault: BUILT_IN_DEFAULTS.db.poolSize,
        nullable: false,
        env,
      }) as number,
    },
    tools: {
      allowed: resolveToolAllowlist({
        configPath: 'tools.allowed',
        ...readLeaf(raw, 'tools', 'allowed'),
      }),
      maxStepsPerRun: resolveNumeric({
        configPath: 'tools.maxStepsPerRun',
        ...readLeaf(raw, 'tools', 'maxStepsPerRun'),
        builtInDefault: BUILT_IN_DEFAULTS.tools.maxStepsPerRun,
        nullable: false,
        env,
      }) as number,
      callTimeoutSeconds: resolveNumeric({
        configPath: 'tools.callTimeoutSeconds',
        ...readLeaf(raw, 'tools', 'callTimeoutSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
        nullable: false,
        env,
      }) as number,
    },
    workers: resolveWorkerProfiles(raw),
  };
}

// ---- File read + parse -----------------------------------------------

function readRawConfig(
  configPath: string,
): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new InstanceConfigError(
      `Failed to read ${configPath}: ${(err as Error).message}`,
    );
  }

  const errors: ParseError[] = [];
  const result: unknown = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    const { line, column } = offsetToLineColumn(text, first.offset);
    throw new InstanceConfigError(
      `Malformed JSONC in ${configPath} at line ${line}, column ${column}: ${printParseErrorCode(first.error)}`,
    );
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new InstanceConfigError(
      `Invalid ${configPath}: top-level value must be a JSON object`,
    );
  }
  return result as Record<string, unknown>;
}

function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const upToOffset = text.slice(0, offset);
  const lines = upToOffset.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// ---- Schema validation --------------------------------------------------

function assertValidRaw(
  raw: Record<string, unknown>,
  configPath: string,
): void {
  const validate = getConfigValidator();
  if (validate(raw)) {
    return;
  }

  const messages = (validate.errors ?? []).map((e) => {
    if (e.keyword === 'additionalProperties') {
      const extra = (e.params as { additionalProperty?: string })
        .additionalProperty;
      const base = e.instancePath === '' ? '' : e.instancePath;
      return `${base}/${extra ?? '?'}: unrecognized key`;
    }
    return `${e.instancePath || '/'}: ${e.message ?? 'is invalid'}`;
  });

  throw new InstanceConfigError(
    `Invalid ${configPath}:\n${messages.map((m) => `  - ${m}`).join('\n')}`,
  );
}

// ---- Per-leaf presence + resolution -------------------------------------

type Leaf = { present: boolean; raw: unknown };

function readLeaf(
  raw: Record<string, unknown> | undefined,
  group: string,
  key: string,
): Leaf {
  if (!raw) {
    return { present: false, raw: undefined };
  }
  const groupValue = raw[group];
  if (
    groupValue === undefined ||
    groupValue === null ||
    typeof groupValue !== 'object'
  ) {
    return { present: false, raw: undefined };
  }
  if (!Object.prototype.hasOwnProperty.call(groupValue, key)) {
    return { present: false, raw: undefined };
  }
  return { present: true, raw: (groupValue as Record<string, unknown>)[key] };
}

/** Resolve a string interpolation, translating a failure into a config-path-scoped, value-free error. */
function resolveInterpolatedString(
  raw: string,
  configPath: string,
  env: NodeJS.ProcessEnv,
): string {
  try {
    return interpolateString(raw, env);
  } catch (err) {
    if (err instanceof InterpolationError) {
      throw new InstanceConfigError(`${configPath}: ${err.message}`);
    }
    throw err;
  }
}

function resolveNullableString(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  env: NodeJS.ProcessEnv;
}): string | null {
  const { configPath, present, raw, env } = opts;
  if (!present || raw === null) {
    // Absent (or explicit null) = unset. The environment reaches config ONLY
    // through {env:...} interpolation tokens in the file — there is no bare
    // env-var fallback (D5).
    return null;
  }
  const resolved = resolveInterpolatedString(
    raw as string,
    configPath,
    env,
  ).trim();
  // Empty (or whitespace-only) resolution on a nullable key means unset.
  // Trimmed so InstanceConfigService.config hands out one normalized shape.
  return resolved === '' ? null : resolved;
}

function resolveNumeric(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  builtInDefault: number | null;
  nullable: boolean;
  env: NodeJS.ProcessEnv;
}): number | null {
  const { configPath, present, raw, builtInDefault, nullable, env } = opts;

  if (!present) {
    // Absent from the file = the built-in default. The environment reaches
    // config ONLY through {env:...} interpolation tokens in the file — there
    // is no bare env-var fallback (D5).
    return builtInDefault;
  }

  if (raw === null) {
    // Unreachable while every numberOrToken/nullableNumberOrToken $def
    // excludes "null" for non-nullable settings — ajv's raw-shape
    // validation already rejects `null` on heartbeatSeconds/timeoutSeconds
    // before this branch can run.
    // Kept as defense-in-depth in case the schema and this map ever drift.
    if (!nullable) {
      throw new InstanceConfigError(
        `${configPath}: must not be null (not a nullable setting)`,
      );
    }
    return null;
  }
  if (typeof raw === 'number') {
    assertPositiveInteger(raw, configPath);
    return raw;
  }

  // Schema validation already guaranteed `raw` is a whole-value
  // {env:...}/{path:...} token string at this point.
  const resolved = resolveInterpolatedString(raw as string, configPath, env);
  if (resolved.trim() === '') {
    if (nullable) {
      return null;
    }
    throw new InstanceConfigError(
      `${configPath}: resolved to an empty value, which is not a valid number`,
    );
  }
  const n = Number(resolved);
  if (!Number.isFinite(n)) {
    throw new InstanceConfigError(
      `${configPath}: interpolated value does not resolve to a valid number`,
    );
  }
  assertPositiveInteger(n, configPath);
  return n;
}

/**
 * Resolve `tools.allowed`: absent → empty (fail closed, no tools). The
 * schema already guarantees an array of non-empty strings when present; this
 * additionally validates every id against the code-owned tool registry —
 * an unknown id fails BOOT naming the config path and the id (design D3: "a
 * typo must not silently disable a tool").
 */
function resolveToolAllowlist(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
}): readonly string[] {
  const { configPath, present, raw } = opts;
  if (!present) {
    return BUILT_IN_DEFAULTS.tools.allowed;
  }
  const ids = raw as string[];
  const registered = new Set(getRegisteredToolIds());
  for (const id of ids) {
    if (!registered.has(id)) {
      throw new InstanceConfigError(
        `${configPath}: unknown tool id "${id}" (not registered)`,
      );
    }
  }
  return ids;
}

/**
 * Resolve `workers`: absent -> the built-in profiles (`all`, `web`) unchanged.
 * Present -> shallow-merged over the built-ins, profile-name keyed — a file
 * entry REPLACES that one profile's group map wholesale (so redeclaring `all`
 * fully overrides it), but a file that only adds an unrelated profile (e.g. a
 * future `heavy`) does not lose `all`/`web`. Group-name and concurrency-value
 * validity (unknown group, non-positive concurrency) is enforced by the JSON
 * Schema's closed per-profile shape (assertValidRaw already ran before this
 * point), so the cast below is trusted the same way resolveToolAllowlist
 * trusts its schema-validated array shape.
 */
function resolveWorkerProfiles(
  raw: Record<string, unknown> | undefined,
): Record<string, WorkerProfile> {
  const fileWorkers = raw?.workers as Record<string, WorkerProfile> | undefined;
  if (!fileWorkers) {
    return BUILT_IN_DEFAULTS.workers;
  }
  return { ...BUILT_IN_DEFAULTS.workers, ...fileWorkers };
}

/**
 * Positivity/integer bound for all four numeric settings (literal or
 * interpolated-and-coerced): a file that says `"timeoutSeconds": -5` is
 * exactly the misconfiguration this feature exists to catch at boot, so it
 * fails loud rather than falling back.
 */
function assertPositiveInteger(n: number, configPath: string): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new InstanceConfigError(`${configPath}: must be a positive integer`);
  }
}
