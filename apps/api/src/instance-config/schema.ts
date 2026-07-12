import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

import { InstanceConfigError } from './instance-config.error';

/**
 * The published JSON Schema (D2/D3) — editors bind to it via the config
 * file's top-level `$schema` key, and this module compiles the SAME file as
 * the boot-time validator, so the two can never drift.
 *
 * Resolved relative to THIS module's own compiled location (`__dirname`),
 * NOT the runtime cwd: a source checkout (`nest start`, jest) has
 * `__dirname` at `src/instance-config`, right next to this file, and a
 * dist-only deploy has it at `dist/instance-config` because `nest build`
 * copies the schema there too (nest-cli.json `compilerOptions.assets`) — the
 * same relative layout either way, so no separate "dist mode" branch.
 */
export const SCHEMA_PATH = path.resolve(__dirname, 'llame.config.schema.json');

/**
 * Read + parse the published schema document. Exported so tests can prove
 * boot validates against this exact artifact.
 *
 * A missing/unreadable/malformed schema file here is an internal packaging
 * problem (see nest-cli.json "assets"), NOT an operator config.json error —
 * wrapped as InstanceConfigError so it never surfaces as a raw, unattributed
 * `ENOENT` that an operator would mistake for their own file.
 */
export function loadSchemaDocument(): Record<string, unknown> {
  try {
    const text = readFileSync(SCHEMA_PATH, 'utf8');
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new InstanceConfigError(
      `The published JSON Schema artifact at ${SCHEMA_PATH} is missing or invalid — this is an internal packaging problem (see nest-cli.json "assets"), not an operator llame.config.json error: ${(err as Error).message}`,
    );
  }
}

let cachedValidator: ValidateFunction | undefined;

/** Compile (once, cached) and return the ajv validator for the published schema. */
export function getConfigValidator(): ValidateFunction {
  cachedValidator ??= new Ajv2020({ allErrors: true, strict: false }).compile(
    loadSchemaDocument(),
  );
  return cachedValidator;
}
