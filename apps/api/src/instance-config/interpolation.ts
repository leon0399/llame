import { readFileSync } from 'node:fs';

/**
 * Value interpolation (D4 / spec "Environment-variable interpolation" +
 * "File-path (secret) interpolation" + "Token placement, typing, and
 * escaping"): `{env:NAME}`, `{env:NAME:-default}`, `{path:LOCATION}`, single
 * -pass, non-recursive — a resolved value is a literal and is never
 * re-scanned for further tokens. `{{` escapes a literal `{`.
 *
 * This module resolves STRING values only. Whole-value coercion to a
 * non-string schema type happens one layer up, in config-loader.ts, which
 * also knows the config path for error messages — this module never sees it,
 * so it cannot accidentally leak one.
 */

/** Where an unresolved-but-required token came from — named in errors, never the value. */
export type InterpolationSource =
  | { kind: 'env'; name: string }
  | { kind: 'path'; location: string };

export class InterpolationError extends Error {
  constructor(
    message: string,
    readonly source: InterpolationSource,
  ) {
    super(message);
    this.name = 'InterpolationError';
  }
}

const ENV_TOKEN = /^\{env:([A-Za-z0-9_]+)(?::-([^}]*))?\}/;
const PATH_TOKEN = /^\{path:([^}]*)\}/;

/** Whole-value token grammar shared with the published schema's `interpolationToken` $def. */
export const WHOLE_VALUE_TOKEN_PATTERN =
  /^\{(?:env:[A-Za-z0-9_]+(?::-[^}]*)?|path:[^}]*)\}$/;

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
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] === '{') {
      if (input[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }

      const rest = input.slice(i);

      const envMatch = ENV_TOKEN.exec(rest);
      if (envMatch) {
        const [full, name, fallback] = envMatch;
        out += resolveEnvToken(name, fallback, env);
        i += full.length;
        continue;
      }

      const pathMatch = PATH_TOKEN.exec(rest);
      if (pathMatch) {
        const [full, location] = pathMatch;
        out += resolvePathToken(location);
        i += full.length;
        continue;
      }
    }

    out += input[i];
    i += 1;
  }
  return out;
}

function resolveEnvToken(
  name: string,
  fallback: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const value = env[name];
  if (fallback !== undefined) {
    // Bash/docker-compose `:-` semantics (D4): the fallback applies when the
    // variable is unset OR empty — that is precisely what distinguishes `:-`
    // from `-`. A blank env var must not shadow the declared default.
    return value === undefined || value === '' ? fallback : value;
  }
  if (value !== undefined) {
    return value;
  }
  throw new InterpolationError(
    `required environment variable ${name} is not set`,
    { kind: 'env', name },
  );
}

/**
 * {path:...} reads any file the process can read, by design: the config file
 * is operator-authored deploy-time input — the same trust level as the
 * process environment itself — so there is no path-traversal boundary to
 * enforce here (an allowlist would break legitimate secret mounts outside
 * /run/secrets). Tenants can never write this file.
 */
function resolvePathToken(location: string): string {
  try {
    return readFileSync(location, 'utf8').trim();
  } catch (err) {
    // The fs error names the path and errno only — never file contents.
    const detail = err instanceof Error ? err.message : String(err);
    throw new InterpolationError(
      `required file ${location} could not be read: ${detail}`,
      { kind: 'path', location },
    );
  }
}
