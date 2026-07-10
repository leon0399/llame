import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

/**
 * The published JSON Schema (D2/D3) — editors bind to it via the config
 * file's top-level `$schema` key, and this module compiles the SAME file as
 * the boot-time validator, so the two can never drift. Resolved like the
 * config file itself: relative to the API's runtime cwd (nest start, jest,
 * and `node dist/main` via `pnpm --filter api start:prod` all run with cwd
 * `apps/api`).
 */
export const SCHEMA_PATH = path.resolve(
  process.cwd(),
  'llame.config.schema.json',
);

/** Read + parse the published schema document. Exported so tests can prove boot validates against this exact artifact. */
export function loadSchemaDocument(): Record<string, unknown> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

let cachedValidator: ValidateFunction | undefined;

/** Compile (once, cached) and return the ajv validator for the published schema. */
export function getConfigValidator(): ValidateFunction {
  cachedValidator ??= new Ajv2020({ allErrors: true, strict: false }).compile(
    loadSchemaDocument(),
  );
  return cachedValidator;
}
