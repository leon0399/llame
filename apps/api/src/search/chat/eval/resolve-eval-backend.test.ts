import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSecret } from './resolve-eval-backend';

const ENV_KEYS = ['LLAME_EVAL_TEST_KEY'] as const;

describe('resolveSecret', () => {
  let originalEnv: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-eval-secret-'));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  it('passes a plain literal through unchanged', () => {
    expect(resolveSecret('sk-plain')).toBe('sk-plain');
  });

  it('resolves a {env:...} token', () => {
    process.env.LLAME_EVAL_TEST_KEY = 'sk-from-env';
    expect(resolveSecret('{env:LLAME_EVAL_TEST_KEY}')).toBe('sk-from-env');
  });

  it('applies the {env:NAME:-default} fallback when unset', () => {
    expect(resolveSecret('{env:LLAME_EVAL_TEST_KEY:-sk-fallback}')).toBe(
      'sk-fallback',
    );
  });

  it('yields undefined when a required {env:...} is unset', () => {
    expect(resolveSecret('{env:LLAME_EVAL_TEST_KEY}')).toBeUndefined();
  });

  it('resolves a {path:...} token from a file', () => {
    const secretFile = path.join(tmpDir, 'api-key.secret');
    writeFileSync(secretFile, 'sk-from-file\n');
    expect(resolveSecret(`{path:${secretFile}}`)).toBe('sk-from-file');
  });

  it('yields undefined when a {path:...} token names a missing file', () => {
    expect(
      resolveSecret(`{path:${path.join(tmpDir, 'does-not-exist.secret')}}`),
    ).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(resolveSecret(12_345)).toBeUndefined();
    expect(resolveSecret(null)).toBeUndefined();
  });
});
