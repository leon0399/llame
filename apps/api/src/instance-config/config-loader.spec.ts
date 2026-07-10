/**
 * Config loader unit tests (openspec/changes/instance-config, task 4.1),
 * plus the numeric-coercion / precedence behavior that lives in
 * config-loader.ts's per-leaf resolvers (tasks 2.2 and, since
 * loadInstanceConfig is the single DI read surface the interface contract
 * requires to already carry file > env > built-in precedence, a slice of
 * task 3.1/4.3 — see report to team lead for why this landed here instead of
 * with the "repoint readers" task).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from './instance-config.error';
import { loadInstanceConfig, resolveConfigPath } from './config-loader';
import { BUILT_IN_DEFAULTS } from './llame-config';

const ENV_KEYS = [
  'LLAME_CONFIG_PATH',
  'DEFAULT_MODEL_ID',
  'TITLE_GENERATION_MODEL_ID',
  'RUN_MAX_OUTPUT_TOKENS',
  'RUN_HEARTBEAT_SECONDS',
  'RUN_HEARTBEAT_STALE_SECONDS',
  'RUN_TIMEOUT_SECONDS',
  'TRUST_PROXY',
] as const;

let originalEnv: Record<string, string | undefined>;
let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];

  // The config file (and the schema) resolve relative to cwd, same as
  // .env.local — chdir into a scratch dir per test so LLAME_CONFIG_PATH can
  // stay relative like an operator would write it, and so "file absent"
  // tests don't accidentally pick up a stray llame.config.json.
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-instance-config-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

function writeConfig(content: string, filename = 'llame.config.json'): string {
  const file = path.join(tmpDir, filename);
  writeFileSync(file, content);
  return file;
}

describe('resolveConfigPath', () => {
  it('defaults to llame.config.json in the runtime cwd', () => {
    expect(resolveConfigPath({})).toBe(path.join(tmpDir, 'llame.config.json'));
  });

  it('LLAME_CONFIG_PATH overrides the default location', () => {
    expect(resolveConfigPath({ LLAME_CONFIG_PATH: 'custom.json' })).toBe(
      path.join(tmpDir, 'custom.json'),
    );
  });
});

describe('loadInstanceConfig — file presence', () => {
  it('boots on documented built-in defaults with no error when the file is absent', () => {
    expect(loadInstanceConfig()).toEqual(BUILT_IN_DEFAULTS);
  });

  it('resolves entirely from an explicitly passed env — process.env is never consulted', () => {
    process.env.DEFAULT_MODEL_ID = 'from-process-env';
    process.env.RUN_TIMEOUT_SECONDS = '999';
    writeConfig('{ "http": { "trustProxy": "{env:IC_LOADER_TRUST:-1}" } }');
    const config = loadInstanceConfig({
      TITLE_GENERATION_MODEL_ID: 'from-custom-env',
    });
    // Env fallbacks read the passed env only:
    expect(config.defaults.modelId).toBeNull();
    expect(config.defaults.titleGenerationModelId).toBe('from-custom-env');
    expect(config.runs.timeoutSeconds).toBe(
      BUILT_IN_DEFAULTS.runs.timeoutSeconds,
    );
    // Interpolation reads the passed env only (IC_LOADER_TRUST unset there):
    expect(config.http.trustProxy).toBe('1');
  });

  it('populates settings from a well-formed file', () => {
    writeConfig(`{
      "defaults": { "modelId": "system:openai:gpt-5.4-mini" },
      "runs": { "timeoutSeconds": 120 }
    }`);
    const config = loadInstanceConfig();
    expect(config.defaults.modelId).toBe('system:openai:gpt-5.4-mini');
    expect(config.runs.timeoutSeconds).toBe(120);
    // Untouched settings still carry their built-in defaults.
    expect(config.runs.heartbeatSeconds).toBe(15);
  });

  it('accepts comments and trailing commas (JSONC)', () => {
    writeConfig(`{
      // instance defaults
      "defaults": {
        "modelId": "system:openai:gpt-5.4-mini", // trailing comma below
      },
      /* runs block */
      "runs": { "timeoutSeconds": 90, },
    }`);
    const config = loadInstanceConfig();
    expect(config.defaults.modelId).toBe('system:openai:gpt-5.4-mini');
    expect(config.runs.timeoutSeconds).toBe(90);
  });

  it('fails loudly, naming the file and parse location, on malformed JSONC', () => {
    const file = writeConfig('{ "defaults": { "modelId": "x", } ');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    try {
      loadInstanceConfig();
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain(file);
      expect((err as Error).message).toMatch(/line \d+, column \d+/);
    }
  });

  it('LLAME_CONFIG_PATH loads that file instead of the default location', () => {
    writeConfig(
      '{ "defaults": { "modelId": "from-override" } }',
      'somewhere-else.json',
    );
    process.env.LLAME_CONFIG_PATH = 'somewhere-else.json';
    expect(loadInstanceConfig().defaults.modelId).toBe('from-override');
  });

  it('a top-level $schema key is exempt and ignored', () => {
    writeConfig(`{
      "$schema": "./llame.config.schema.json",
      "defaults": { "modelId": "system:openai:gpt-5.4-mini" }
    }`);
    expect(loadInstanceConfig().defaults.modelId).toBe(
      'system:openai:gpt-5.4-mini',
    );
  });
});

describe('loadInstanceConfig — strict schema', () => {
  it('fails on an unknown key, naming the offending path', () => {
    writeConfig('{ "runs": { "timoutSeconds": 100 } }');
    expect(() => loadInstanceConfig()).toThrow(/timoutSeconds/);
  });

  it('rejects the killed compaction.* instance setting as unknown', () => {
    writeConfig('{ "compaction": { "tokenThreshold": 1000 } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/compaction/);
  });

  it('fails on a value of the wrong type', () => {
    writeConfig('{ "runs": { "timeoutSeconds": "not-a-number-or-token" } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/timeoutSeconds/);
  });
});

describe('loadInstanceConfig — whole-value numeric interpolation (task 2.2)', () => {
  it('coerces a resolved whole-value token to a number', () => {
    process.env.RUN_TIMEOUT_SECONDS_SRC = '450';
    writeConfig(
      '{ "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" } }',
    );
    expect(loadInstanceConfig().runs.timeoutSeconds).toBe(450);
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  it('fails startup, naming the path, when the resolved value does not coerce to a number', () => {
    process.env.RUN_TIMEOUT_SECONDS_SRC = 'not-a-number';
    writeConfig(
      '{ "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" } }',
    );
    expect(() => loadInstanceConfig()).toThrow(/runs\.timeoutSeconds/);
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  it('fails startup, naming the path, on a literal negative number in the file', () => {
    // Caught by the raw-shape ajv validation stage (integer, minimum: 1),
    // before resolveNumeric's own defense-in-depth check ever runs — so the
    // path is named ajv-style (slash), not the dotted config-path style
    // resolveNumeric uses for values it resolves itself.
    writeConfig('{ "runs": { "timeoutSeconds": -5 } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/runs\/timeoutSeconds/);
  });

  it('fails startup, naming the path, on a literal fractional number in the file', () => {
    writeConfig('{ "runs": { "heartbeatSeconds": 2.5 } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/runs\/heartbeatSeconds/);
  });

  it('fails startup, naming the path, when a token resolves to a non-positive number', () => {
    process.env.RUN_TIMEOUT_SECONDS_SRC = '-5';
    writeConfig(
      '{ "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" } }',
    );
    expect(() => loadInstanceConfig()).toThrow(/runs\.timeoutSeconds/);
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  it('fails startup, naming the path, when a token resolves to a fractional number', () => {
    process.env.RUN_TIMEOUT_SECONDS_SRC = '2.5';
    writeConfig(
      '{ "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" } }',
    );
    expect(() => loadInstanceConfig()).toThrow(/runs\.timeoutSeconds/);
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  // (The "token resolving to a valid positive integer passes" case is
  // already covered by the first test in this block — not re-asserted here.)

  it('the legacy env fallback (file key absent) stays tolerant of a non-positive/garbage value', () => {
    process.env.RUN_TIMEOUT_SECONDS = '-5';
    // No file at all — env fallback path, not file-interpolation.
    expect(loadInstanceConfig().runs.timeoutSeconds).toBe(300);
    delete process.env.RUN_TIMEOUT_SECONDS;
  });

  it('empty resolution on a nullable numeric key means unset (null)', () => {
    writeConfig(
      '{ "runs": { "maxOutputTokens": "{env:RUN_MAX_OUTPUT_TOKENS_SRC:-}" } }',
    );
    expect(loadInstanceConfig().runs.maxOutputTokens).toBeNull();
  });

  it('empty resolution on a nullable string key means unset (null) — the spec.md TRUST_PROXY example', () => {
    writeConfig('{ "http": { "trustProxy": "{env:TRUST_PROXY_SRC:-}" } }');
    expect(loadInstanceConfig().http.trustProxy).toBeNull();
  });

  it('fails startup, naming the config path, when a string setting has a required env token and the variable is unset', () => {
    writeConfig('{ "http": { "trustProxy": "{env:IC_LOADER_REQUIRED_VAR}" } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/http\.trustProxy/);
    expect(() => loadInstanceConfig()).toThrow(/IC_LOADER_REQUIRED_VAR/);
  });

  it('embeds a token within a string-typed setting', () => {
    process.env.RUN_TIMEOUT_SECONDS_SRC = 'gpt-5.4-nano';
    writeConfig(
      '{ "defaults": { "modelId": "system:openai:{env:RUN_TIMEOUT_SECONDS_SRC}" } }',
    );
    expect(loadInstanceConfig().defaults.modelId).toBe(
      'system:openai:gpt-5.4-nano',
    );
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  it('resolves a {path:...} secret to its trimmed file contents', () => {
    const secretFile = path.join(tmpDir, 'model-id.secret');
    writeFileSync(secretFile, '  system:openai:gpt-5.4-mini  \n');
    writeConfig(
      `{ "defaults": { "modelId": "{path:${secretFile.replace(/\\/g, '\\\\')}}" } }`,
    );
    expect(loadInstanceConfig().defaults.modelId).toBe(
      'system:openai:gpt-5.4-mini',
    );
  });

  it('fails startup, naming the location, when the {path:...} file is missing', () => {
    const missing = path.join(tmpDir, 'does-not-exist.secret');
    writeConfig(`{ "defaults": { "modelId": "{path:${missing}}" } }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    try {
      loadInstanceConfig();
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain(missing);
    }
  });

  it('{{ escapes to a literal { in a resolved string setting', () => {
    writeConfig('{ "http": { "trustProxy": "literal {{not-a-real-token" } }');
    expect(loadInstanceConfig().http.trustProxy).toBe(
      'literal {not-a-real-token',
    );
  });

  it('a padded (non-empty, non-trimmed) literal file value is normalized the same way the env fallback already is', () => {
    // Pins the trim-asymmetry fix: resolveNullableString's file branch used
    // to return the untrimmed value for anything non-blank, while the
    // env-fallback branch always trimmed — the same setting could carry
    // padding or not depending purely on which source set it.
    writeConfig(
      '{ "defaults": { "modelId": "  system:openai:gpt-5.4-mini  " } }',
    );
    expect(loadInstanceConfig().defaults.modelId).toBe(
      'system:openai:gpt-5.4-mini',
    );
  });

  it('a padded literal value on another nullable-string setting (http.trustProxy) is normalized too', () => {
    writeConfig('{ "http": { "trustProxy": " 1 " } }');
    expect(loadInstanceConfig().http.trustProxy).toBe('1');
  });
});

describe('loadInstanceConfig — precedence (file > env > built-in default)', () => {
  it('file value wins over a set legacy env var', () => {
    process.env.DEFAULT_MODEL_ID = 'from-env';
    writeConfig('{ "defaults": { "modelId": "from-file" } }');
    expect(loadInstanceConfig().defaults.modelId).toBe('from-file');
  });

  it('the legacy env var is used when the file does not set the key', () => {
    process.env.DEFAULT_MODEL_ID = 'from-env';
    writeConfig('{ "runs": { "timeoutSeconds": 10 } }');
    expect(loadInstanceConfig().defaults.modelId).toBe('from-env');
  });

  it('an explicit null in the file suppresses the env fallback', () => {
    process.env.TRUST_PROXY = '1';
    writeConfig('{ "http": { "trustProxy": null } }');
    expect(loadInstanceConfig().http.trustProxy).toBeNull();
  });

  it('falls to the built-in default when neither file nor env sets the key', () => {
    expect(loadInstanceConfig().runs.timeoutSeconds).toBe(300);
  });

  it('runs.maxOutputTokens is file-only — RUN_MAX_OUTPUT_TOKENS is not a real fallback (it has never existed in this repo)', () => {
    process.env.RUN_MAX_OUTPUT_TOKENS = '4096';
    // No file at all — if a fallback wired this env var, it would win here.
    expect(loadInstanceConfig().runs.maxOutputTokens).toBeNull();
    delete process.env.RUN_MAX_OUTPUT_TOKENS;
  });
});

describe('loadInstanceConfig — no secret in logs', () => {
  it('a coercion failure alongside an already-resolved sibling secret never leaks the secret', () => {
    // defaults.* resolves before runs.* in loadInstanceConfig's assembly
    // order, so the secret below is already resolved in memory by the time
    // the runs.timeoutSeconds coercion throws.
    process.env.RUN_TIMEOUT_SECONDS_SRC = 'garbage';
    const secretFile = path.join(tmpDir, 'openai.secret');
    writeFileSync(secretFile, 'sk-should-never-appear-in-any-error');
    writeConfig(`{
      "defaults": { "modelId": "{path:${secretFile.replace(/\\/g, '\\\\')}}" },
      "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" }
    }`);
    try {
      loadInstanceConfig();
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).not.toContain(
        'sk-should-never-appear-in-any-error',
      );
    }
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });
});
