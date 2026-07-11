/**
 * Config loader unit tests (openspec/changes/instance-config, task 4.1),
 * plus the numeric-coercion / precedence behavior that lives in
 * config-loader.ts's per-leaf resolvers. Precedence is file > built-in
 * default — the environment reaches config only via {env:...} interpolation
 * tokens inside the file (no bare env-var fallback).
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
    process.env.IC_LOADER_TRUST = 'from-process-env';
    writeConfig(`{
      "defaults": { "modelId": "{env:IC_LOADER_MODEL:-}" },
      "http": { "trustProxy": "{env:IC_LOADER_TRUST:-1}" }
    }`);
    const config = loadInstanceConfig({ IC_LOADER_MODEL: 'from-custom-env' });
    // Interpolation reads the passed env only:
    expect(config.defaults.modelId).toBe('from-custom-env');
    // IC_LOADER_TRUST is set in process.env but NOT in the passed env — the
    // token's :- default applies, proving process.env is never consulted.
    expect(config.http.trustProxy).toBe('1');
    delete process.env.IC_LOADER_TRUST;
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

  it('the committed llame.config.json.example loads clean (cp example = working instance)', () => {
    // The example is the documented quickstart (`cp` it and boot) — pin that
    // it stays loader-valid as it evolves, and that tool calling + search are
    // enabled by default per the operator posture it recommends.
    process.env.LLAME_CONFIG_PATH = path.resolve(
      __dirname,
      '../../llame.config.json.example',
    );
    const config = loadInstanceConfig();
    expect(config.defaults.modelId).toBe('system:openai:gpt-5.4-mini');
    expect(config.tools.allowed).toContain('search_conversations');
    expect(config.tools.maxStepsPerRun).toBe(8);
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

describe('loadInstanceConfig — tools.* (openspec/changes/tool-calling-loop)', () => {
  it('defaults to no tools, cap 8, timeout 15 when the file omits tools', () => {
    const config = loadInstanceConfig();
    expect(config.tools).toEqual({
      allowed: [],
      maxStepsPerRun: 8,
      callTimeoutSeconds: 15,
    });
  });

  it('resolves tools.allowed from the file when every id is registered', () => {
    writeConfig('{ "tools": { "allowed": ["search_conversations"] } }');
    expect(loadInstanceConfig().tools.allowed).toEqual([
      'search_conversations',
    ]);
  });

  it('fails BOOT naming the path and the id when tools.allowed names an unregistered tool', () => {
    writeConfig('{ "tools": { "allowed": ["not_a_real_tool"] } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/tools\.allowed/);
    expect(() => loadInstanceConfig()).toThrow(/not_a_real_tool/);
  });

  it('resolves maxStepsPerRun / callTimeoutSeconds overrides from the file', () => {
    writeConfig(
      '{ "tools": { "maxStepsPerRun": 3, "callTimeoutSeconds": 5 } }',
    );
    const config = loadInstanceConfig();
    expect(config.tools.maxStepsPerRun).toBe(3);
    expect(config.tools.callTimeoutSeconds).toBe(5);
  });

  it('rejects a non-positive-integer maxStepsPerRun (same numeric bound as runs.*)', () => {
    writeConfig('{ "tools": { "maxStepsPerRun": 0 } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('rejects an unknown key under tools (strict schema)', () => {
    writeConfig('{ "tools": { "allowedd": [] } }');
    expect(() => loadInstanceConfig()).toThrow(/allowedd/);
  });
});

describe('loadInstanceConfig — precedence (file > built-in default, no bare env fallback)', () => {
  it('a bare legacy env var has NO effect — env reaches config only via {env:...} tokens', () => {
    process.env.DEFAULT_MODEL_ID = 'from-env';
    process.env.RUN_TIMEOUT_SECONDS = '999';
    process.env.TRUST_PROXY = '1';
    writeConfig('{ "runs": { "heartbeatSeconds": 20 } }');
    const config = loadInstanceConfig();
    expect(config.defaults.modelId).toBeNull();
    expect(config.runs.timeoutSeconds).toBe(300);
    expect(config.http.trustProxy).toBeNull();
    // The file value it DID set still applies.
    expect(config.runs.heartbeatSeconds).toBe(20);
  });

  it('the same env var DOES apply when the file references it via a token', () => {
    process.env.DEFAULT_MODEL_ID = 'from-env-via-token';
    writeConfig('{ "defaults": { "modelId": "{env:DEFAULT_MODEL_ID}" } }');
    expect(loadInstanceConfig().defaults.modelId).toBe('from-env-via-token');
  });

  it('an explicit null on a nullable setting is unset, same as absent', () => {
    writeConfig('{ "http": { "trustProxy": null } }');
    expect(loadInstanceConfig().http.trustProxy).toBeNull();
  });

  it('falls to the built-in default when the file does not set the key', () => {
    expect(loadInstanceConfig().runs.timeoutSeconds).toBe(300);
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
