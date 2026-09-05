import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

import { InstanceConfigError } from '@workspace/config-interpolation';
import type { RawInstanceConfig } from './llame-config';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The published JSON Schema (D2/D3) — editors bind to it via the config
 * file's top-level `$schema` key, and this module compiles the SAME file as
 * the boot-time validator, so the two can never drift.
 *
 * Resolved relative to THIS module's own compiled location (`__dirname`),
 * NOT the runtime cwd: a source checkout (`nest start`, vitest) has
 * `__dirname` at `src/instance-config`, right next to this file, and a
 * dist-only deploy has it at `dist/instance-config` because `nest build`
 * copies the schema there too (nest-cli.json `compilerOptions.assets`) — the
 * same relative layout either way, so no separate "dist mode" branch.
 */
export const SCHEMA_PATH = path.resolve(__dirname, 'llame.config.schema.json');

/**
 * Test seam (anti-slop/no-module-mocking): `node:fs`'s own exports object
 * rejects `vi.spyOn` (its properties are non-configurable in this runtime —
 * "Cannot redefine property"), so tests that need to simulate a missing or
 * unreadable schema file substitute this instead of module-mocking `node:fs`.
 * Production call sites never pass it — the default reads the real file.
 */
export type SchemaFileAccess = {
  readFile(filePath: string): string;
};

const DEFAULT_SCHEMA_FILE_ACCESS: SchemaFileAccess = {
  readFile: (filePath) => readFileSync(filePath, 'utf8'),
};

/**
 * Read + parse the published schema document. Exported so tests can prove
 * boot validates against this exact artifact.
 *
 * A missing/unreadable/malformed schema file here is an internal packaging
 * problem (see nest-cli.json "assets"), NOT an operator config.json error —
 * wrapped as InstanceConfigError so it never surfaces as a raw, unattributed
 * `ENOENT` that an operator would mistake for their own file.
 */
export function loadSchemaDocument(
  access: SchemaFileAccess = DEFAULT_SCHEMA_FILE_ACCESS,
): UnknownRecord {
  let parsed: unknown;
  try {
    const text = access.readFile(SCHEMA_PATH);
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InstanceConfigError(
      `The published JSON Schema artifact at ${SCHEMA_PATH} is missing or invalid — this is an internal packaging problem (see nest-cli.json "assets"), not an operator llame.config.json error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new InstanceConfigError(
      `The published JSON Schema artifact at ${SCHEMA_PATH} is not a JSON object — this is an internal packaging problem (see nest-cli.json "assets"), not an operator llame.config.json error.`,
    );
  }
  return parsed;
}

let cachedValidator: ValidateFunction<RawInstanceConfig> | undefined;

/**
 * Compile (once, cached) and return the ajv validator for the published
 * schema. Parameterizing the compile call with `RawInstanceConfig` makes the
 * returned function's call signature a real type predicate
 * (`data is RawInstanceConfig`, ajv's own `ValidateFunction<T>` contract) —
 * `assertValidRaw` (config-loader.ts) relies on that to narrow the parsed
 * document without a cast.
 */
export function getConfigValidator(): ValidateFunction<RawInstanceConfig> {
  cachedValidator ??= new Ajv2020({
    allErrors: true,
    strict: false,
  }).compile<RawInstanceConfig>(loadSchemaDocument());
  return cachedValidator;
}
