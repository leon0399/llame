/**
 * Published-schema tests (openspec/changes/instance-config, task 4.1 —
 * "Published schema is the validator" and "Raw file with a token on a
 * numeric setting is editor-valid" scenarios from spec.md).
 */
import { readFileSync } from 'node:fs';

import { WHOLE_VALUE_TOKEN_PATTERN } from './interpolation';
import { getConfigValidator, loadSchemaDocument, SCHEMA_PATH } from './schema';

describe('published schema — single artifact', () => {
  it('loadSchemaDocument returns exactly what is on disk at the published path', () => {
    const onDisk = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as unknown;
    expect(loadSchemaDocument()).toEqual(onDisk);
  });

  it('is a strict-closed schema with the $schema exemption declared', () => {
    const schema = loadSchemaDocument();
    expect(schema.additionalProperties).toBe(false);
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.$schema).toBeDefined();
  });

  it('interpolation.ts WHOLE_VALUE_TOKEN_PATTERN never silently drifts from the published $defs.interpolationToken.pattern', () => {
    const schema = loadSchemaDocument();
    const defs = schema.$defs as Record<string, { pattern: string }>;
    // WHOLE_VALUE_TOKEN_PATTERN is anchored with ^...$; the JSON Schema
    // "pattern" keyword is implicitly unanchored-but-substring-matched by
    // some engines, so the schema copy is written the same anchored way —
    // compare the literal regex sources, not just observed behavior, so a
    // hand-edit to either side that changes the grammar is caught here
    // rather than discovered as silent runtime divergence.
    expect(WHOLE_VALUE_TOKEN_PATTERN.source).toBe(
      defs.interpolationToken.pattern,
    );
  });
});

describe('published schema — raw (pre-interpolation) file validity, as an editor sees it', () => {
  it('a whole-value token on a numeric setting validates via the token branch', () => {
    const validate = getConfigValidator();
    expect(
      validate({ runs: { timeoutSeconds: '{env:RUN_TIMEOUT_SECONDS:-300}' } }),
    ).toBe(true);
    expect(
      validate({ runs: { maxOutputTokens: '{path:/run/secrets/x}' } }),
    ).toBe(true);
  });

  it('a real number still validates directly', () => {
    const validate = getConfigValidator();
    expect(validate({ runs: { timeoutSeconds: 300 } })).toBe(true);
  });

  it('a non-token string on a numeric setting fails validation', () => {
    const validate = getConfigValidator();
    expect(validate({ runs: { timeoutSeconds: 'abc' } })).toBe(false);
  });

  it('a string that merely looks bracey but is not a recognized token fails validation', () => {
    const validate = getConfigValidator();
    expect(validate({ runs: { timeoutSeconds: '{foo}' } })).toBe(false);
  });
});
