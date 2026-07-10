import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';

import { isPositiveFinite } from '../compaction/compaction';
import { BUILT_IN_DEFAULTS, type LlameConfig } from './llame-config';
import { InstanceConfigError } from './instance-config.error';
import { getConfigValidator } from './schema';
import { InterpolationError, interpolateString } from './interpolation';

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

/** Load, validate, interpolate, and apply file > env > built-in precedence. Throws InstanceConfigError on any failure — the only correct response is to abort boot (D6). */
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
        envVar: 'DEFAULT_MODEL_ID',
        env,
      }),
      titleGenerationModelId: resolveNullableString({
        configPath: 'defaults.titleGenerationModelId',
        ...readLeaf(raw, 'defaults', 'titleGenerationModelId'),
        envVar: 'TITLE_GENERATION_MODEL_ID',
        env,
      }),
    },
    runs: {
      // File-only — no legacy env var (RUN_MAX_OUTPUT_TOKENS has never
      // existed in this repo, so there is nothing to fall back to).
      maxOutputTokens: resolveNumeric({
        configPath: 'runs.maxOutputTokens',
        ...readLeaf(raw, 'runs', 'maxOutputTokens'),
        envVar: null,
        builtInDefault: BUILT_IN_DEFAULTS.runs.maxOutputTokens,
        nullable: true,
        env,
      }),
      // nullable:false guarantees a number, never null — see resolveNumeric.
      heartbeatSeconds: resolveNumeric({
        configPath: 'runs.heartbeatSeconds',
        ...readLeaf(raw, 'runs', 'heartbeatSeconds'),
        envVar: 'RUN_HEARTBEAT_SECONDS',
        builtInDefault: BUILT_IN_DEFAULTS.runs.heartbeatSeconds,
        nullable: false,
        env,
      }) as number,
      heartbeatStaleSeconds: resolveNumeric({
        configPath: 'runs.heartbeatStaleSeconds',
        ...readLeaf(raw, 'runs', 'heartbeatStaleSeconds'),
        envVar: 'RUN_HEARTBEAT_STALE_SECONDS',
        builtInDefault: BUILT_IN_DEFAULTS.runs.heartbeatStaleSeconds,
        nullable: false,
        env,
      }) as number,
      timeoutSeconds: resolveNumeric({
        configPath: 'runs.timeoutSeconds',
        ...readLeaf(raw, 'runs', 'timeoutSeconds'),
        envVar: 'RUN_TIMEOUT_SECONDS',
        builtInDefault: BUILT_IN_DEFAULTS.runs.timeoutSeconds,
        nullable: false,
        env,
      }) as number,
    },
    http: {
      trustProxy: resolveNullableString({
        configPath: 'http.trustProxy',
        ...readLeaf(raw, 'http', 'trustProxy'),
        envVar: 'TRUST_PROXY',
        env,
      }),
    },
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
  envVar: string;
  env: NodeJS.ProcessEnv;
}): string | null {
  const { configPath, present, raw, envVar, env } = opts;
  if (present) {
    // Explicit null in the file suppresses the env fallback entirely (spec:
    // "File precedence over ambient environment" — explicit null overrides).
    if (raw === null) {
      return null;
    }
    const resolved = resolveInterpolatedString(
      raw as string,
      configPath,
      env,
    ).trim();
    // Empty (or whitespace-only) resolution on a nullable key means unset.
    // Trimmed here so InstanceConfigService.config hands out one normalized
    // shape regardless of source — same as the env-fallback branch below.
    return resolved === '' ? null : resolved;
  }

  // Defined-but-empty (or whitespace-only) env var = unset — the pre-existing
  // env semantics this feature preserves (D5; same rule the interpolation
  // layer's empty-on-nullable scenario documents).
  const envRaw = env[envVar]?.trim();
  return envRaw ? envRaw : null;
}

function resolveNumeric(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  /** Legacy env var name to fall back to when absent from the file, or `null` for a file-only setting with no legacy env var (e.g. runs.maxOutputTokens, which never had one). */
  envVar: string | null;
  builtInDefault: number | null;
  nullable: boolean;
  env: NodeJS.ProcessEnv;
}): number | null {
  const { configPath, present, raw, envVar, builtInDefault, nullable, env } =
    opts;

  if (present) {
    if (raw === null) {
      // Unreachable while every numberOrToken/nullableNumberOrToken $def
      // excludes "null" for non-nullable settings — ajv's raw-shape
      // validation already rejects `null` on heartbeatSeconds/
      // heartbeatStaleSeconds/timeoutSeconds before this branch can run.
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

  // Not set in the file — legacy env fallback (if any), then the built-in
  // default. Tolerant on purpose (existing semantics this replaces silently
  // fell through on garbage/non-positive values rather than failing boot):
  // every settings reaching this point (the three run timers) is a
  // non-nullable positive-seconds field, so the "usable positive number"
  // predicate this repo already has (compaction.ts) applies unconditionally.
  if (envVar === null) {
    return builtInDefault;
  }
  const envRaw = env[envVar];
  if (envRaw === undefined || envRaw.trim() === '') {
    return builtInDefault;
  }
  const n = Number(envRaw);
  return isPositiveFinite(n) ? n : builtInDefault;
}

/**
 * Positivity/integer bound for all four numeric settings — applies ONLY to
 * file-provided values (literal or interpolated-and-coerced): a file that
 * says `"timeoutSeconds": -5` is exactly the misconfiguration this feature
 * exists to catch at boot, so it fails loud rather than falling back. The
 * legacy env-fallback path above stays tolerant on purpose (unchanged
 * pre-existing behavior for env-only deploys).
 */
function assertPositiveInteger(n: number, configPath: string): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new InstanceConfigError(`${configPath}: must be a positive integer`);
  }
}
