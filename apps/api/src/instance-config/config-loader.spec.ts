/**
 * Config loader unit tests (openspec/changes/instance-config, task 4.1),
 * plus the numeric-coercion / precedence behavior that lives in
 * config-loader.ts's per-leaf resolvers. Precedence is file > built-in
 * default — the environment reaches config only via {env:...} interpolation
 * tokens inside the file (no bare env-var fallback).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

function writePrompt(content: string, filename: string): string {
  const file = path.join(tmpDir, filename);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** A single minimal `providers[]` entry, reused across fixtures that just need a provider id `models[].provider` can reference. */
const SINGLE_PROVIDER_JSON = '"providers": [{ "id": "p", "type": "openai" }]';

/**
 * A minimal valid `providers[]`/`models[]` pair naming a single model with
 * the given id — spliced into fixtures that set `defaults.modelId` (or
 * `titleGenerationModelId`) to a value they expect to resolve successfully.
 * Boot now validates that pointer against `models[]` (providers-and-models-
 * as-code, #167), so a fixture asserting a specific resolved modelId must
 * also configure a model with that id, or it fails the boot validation this
 * spec block isn't testing.
 */
function modelFixtureJson(modelId: string): string {
  return `${SINGLE_PROVIDER_JSON}, "models": [{ "id": ${JSON.stringify(modelId)}, "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000 }]`;
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
      "http": { "trustProxy": "{env:IC_LOADER_TRUST:-1}" },
      ${modelFixtureJson('from-custom-env')}
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
      "runs": { "timeoutSeconds": 120 },
      ${modelFixtureJson('system:openai:gpt-5.4-mini')}
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
      ${modelFixtureJson('system:openai:gpt-5.4-mini')},
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
      `{ "defaults": { "modelId": "from-override" }, ${modelFixtureJson('from-override')} }`,
      'somewhere-else.json',
    );
    process.env.LLAME_CONFIG_PATH = 'somewhere-else.json';
    expect(loadInstanceConfig().defaults.modelId).toBe('from-override');
  });

  it('a top-level $schema key is exempt and ignored', () => {
    writeConfig(`{
      "$schema": "./llame.config.schema.json",
      "defaults": { "modelId": "system:openai:gpt-5.4-mini" },
      ${modelFixtureJson('system:openai:gpt-5.4-mini')}
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

  it("enforces pg-boss's >= 10 heartbeatSeconds floor even for an {env:...}-interpolated value (design D7 / review)", () => {
    // A literal `5` is caught by the schema's minimum:10; an {env:...} token
    // bypasses that (the token only has to be a valid string), so the floor
    // must ALSO be enforced post-interpolation — otherwise boot crashes with a
    // raw pg-boss assertion instead of a clear config error.
    process.env.RUN_HEARTBEAT_SECONDS = '5';
    writeConfig(
      '{ "runs": { "heartbeatSeconds": "{env:RUN_HEARTBEAT_SECONDS}" } }',
    );
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/runs\.heartbeatSeconds/);
    expect(() => loadInstanceConfig()).toThrow(/>= 10/);
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
      `{ "defaults": { "modelId": "system:openai:{env:RUN_TIMEOUT_SECONDS_SRC}" }, ${modelFixtureJson('system:openai:gpt-5.4-nano')} }`,
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
      `{ "defaults": { "modelId": "{path:${secretFile.replace(/\\/g, '\\\\')}}" }, ${modelFixtureJson('system:openai:gpt-5.4-mini')} }`,
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
      `{ "defaults": { "modelId": "  system:openai:gpt-5.4-mini  " }, ${modelFixtureJson('system:openai:gpt-5.4-mini')} }`,
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
    writeConfig(
      `{ "defaults": { "modelId": "{env:DEFAULT_MODEL_ID}" }, ${modelFixtureJson('from-env-via-token')} }`,
    );
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

describe('loadInstanceConfig — worker profiles (durable-run-workers D2, task 3.1)', () => {
  it('falls to the built-in `all`/`web` profiles when the file does not set `workers`', () => {
    expect(loadInstanceConfig().workers).toEqual(BUILT_IN_DEFAULTS.workers);
  });

  it('merges a file profile over a built-in PER GROUP — tuning one group keeps the others (no silent drop)', () => {
    writeConfig(`{ "workers": { "all": { "runs": 4 } } }`);
    const config = loadInstanceConfig();
    // `all` keeps search-reindex/sessions-cleanup at their built-in 1; only
    // runs is overridden — the footgun fix (a wholesale replace would have
    // silently disabled the other two groups instance-wide).
    expect(config.workers.all).toEqual({
      runs: 4,
      'search-reindex': 1,
      'sessions-cleanup': 1,
    });
    expect(config.workers.web).toEqual({});
  });

  it('a brand-new profile name is added alongside the built-ins, not instead of them', () => {
    writeConfig(`{ "workers": { "heavy": { "runs": 2 } } }`);
    const config = loadInstanceConfig();
    expect(config.workers.heavy).toEqual({ runs: 2 });
    expect(config.workers.all).toEqual(BUILT_IN_DEFAULTS.workers.all);
    expect(config.workers.web).toEqual(BUILT_IN_DEFAULTS.workers.web);
  });

  it('fails boot on an unknown group name, naming the offending path (fail-closed)', () => {
    writeConfig(`{ "workers": { "all": { "embeddings": 1 } } }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/embeddings/);
  });

  it('fails boot on a non-positive concurrency', () => {
    writeConfig(`{ "workers": { "all": { "runs": 0 } } }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });
});

describe('loadInstanceConfig — providers[] / models[] (providers-and-models-as-code, #167)', () => {
  it('resolves a valid provider + model pair', () => {
    writeConfig(`{
      "providers": [{ "id": "openai", "type": "openai", "key": "{env:PM_KEY:-}", "baseUrl": "{env:PM_BASE_URL:-}" }],
      "models": [{ "id": "system:openai:gpt-5.4-mini", "provider": "openai", "providerModelId": "gpt-5.4-mini", "contextWindowTokens": 400000 }],
      "defaults": { "modelId": "system:openai:gpt-5.4-mini" }
    }`);
    const config = loadInstanceConfig();
    expect(config.providers).toEqual([
      { id: 'openai', type: 'openai', key: null, baseUrl: null },
    ]);
    expect(config.models).toHaveLength(1);
    expect(config.models[0]).toMatchObject({
      id: 'system:openai:gpt-5.4-mini',
      source: 'system',
      provider: 'openai',
      providerModelId: 'gpt-5.4-mini',
      contextWindowTokens: 400000,
    });
  });

  it('two providers of the same type coexist by distinct id', () => {
    writeConfig(`{
      "providers": [
        { "id": "openai", "type": "openai" },
        { "id": "ollama", "type": "openai", "baseUrl": "http://localhost:11434/v1" }
      ]
    }`);
    const config = loadInstanceConfig();
    expect(config.providers.map((p) => p.id)).toEqual(['openai', 'ollama']);
  });

  it('rejects a duplicate provider id', () => {
    writeConfig(`{
      "providers": [
        { "id": "openai", "type": "openai" },
        { "id": "openai", "type": "openai" }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /duplicate provider id "openai"/,
    );
  });

  it('rejects an unsupported provider type at the schema layer', () => {
    writeConfig(`{ "providers": [{ "id": "claude", "type": "anthropic" }] }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/providers/);
  });

  it('a keyless provider resolves key to null', () => {
    writeConfig(
      `{ "providers": [{ "id": "ollama", "type": "openai", "key": "{env:PM_KEY_UNSET:-}" }] }`,
    );
    expect(loadInstanceConfig().providers[0].key).toBeNull();
  });

  it('rejects a duplicate model id', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "models": [
        { "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000 },
        { "id": "m", "provider": "p", "providerModelId": "y", "contextWindowTokens": 1000 }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/duplicate model id "m"/);
  });

  it('fails boot naming the model id and the dangling reference when models[].provider is unknown', () => {
    writeConfig(`{
      "models": [{ "id": "m", "provider": "ghost", "providerModelId": "x", "contextWindowTokens": 1000 }]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/models\[m\]\.provider/);
    expect(() => loadInstanceConfig()).toThrow(/"ghost"/);
  });

  it('fails schema validation when a model omits contextWindowTokens', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "models": [{ "id": "m", "provider": "p", "providerModelId": "x" }]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails schema validation when contextWindowTokens is non-positive', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "models": [{ "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 0 }]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  describe('models[].systemPromptFile', () => {
    it('resolves a relative override against the active config directory', () => {
      writePrompt('Relative prompt for ${model.id}\n', 'prompts/model.md');
      writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "m",
          "provider": "p",
          "providerModelId": "x",
          "contextWindowTokens": 1000,
          "systemPromptFile": "prompts/model.md"
        }]
      }`);

      expect(loadInstanceConfig().models[0]).toMatchObject({
        systemPrompt: 'Relative prompt for m',
        systemPromptSource: 'model_override',
      });
    });

    it('reads an absolute override path unchanged', () => {
      const promptPath = writePrompt('Absolute prompt', 'absolute.md');
      writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "m",
          "provider": "p",
          "providerModelId": "x",
          "contextWindowTokens": 1000,
          "systemPromptFile": ${JSON.stringify(promptPath)}
        }]
      }`);

      expect(loadInstanceConfig().models[0]).toMatchObject({
        systemPrompt: 'Absolute prompt',
        systemPromptSource: 'model_override',
      });
    });

    it('normalizes CRLF and CR to LF while removing whitespace only at EOF', () => {
      writePrompt('alpha  \r\nbeta\t\rthird\r\n \t\r\n', 'prompt.md');
      writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "m",
          "provider": "p",
          "providerModelId": "x",
          "contextWindowTokens": 1000,
          "systemPromptFile": "prompt.md"
        }]
      }`);

      expect(loadInstanceConfig().models[0].systemPrompt).toBe(
        'alpha  \nbeta\t\nthird',
      );
    });

    it('renders the exact id, name, and literal-name escape surface in an override', () => {
      writePrompt('${model.id}|${model.name}|$${model.name}', 'override.md');
      writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "model-id",
          "name": "Model Name",
          "provider": "p",
          "providerModelId": "x",
          "contextWindowTokens": 1000,
          "systemPromptFile": "override.md"
        }]
      }`);

      expect(loadInstanceConfig().models[0].systemPrompt).toBe(
        'model-id|Model Name|${model.name}',
      );
    });

    it('uses the packaged project default when the override is omitted', () => {
      writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "model-with-default",
          "provider": "p",
          "providerModelId": "x",
          "contextWindowTokens": 1000
        }]
      }`);

      const model = loadInstanceConfig().models[0];
      expect(model.systemPromptSource).toBe('project_default');
      expect(model.systemPrompt).toMatch(/\S/);
      expect(model).not.toHaveProperty('systemPromptFile');
    });

    it.each([
      ['missing', 'missing.md'],
      ['non-file', 'prompt-directory'],
      ['empty', 'empty.md'],
    ])(
      'fails boot for a %s override without using the default',
      (_kind, file) => {
        if (file === 'prompt-directory') {
          mkdirSync(path.join(tmpDir, file));
        } else if (file === 'empty.md') {
          writePrompt(' \r\n\t', file);
        }
        writeConfig(`{
        ${SINGLE_PROVIDER_JSON},
        "models": [{
          "id": "broken-model",
          "provider": "p",
          "providerModelId": "server-only-model-id",
          "contextWindowTokens": 1000,
          "systemPromptFile": ${JSON.stringify(file)}
        }]
      }`);

        expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
        expect(() => loadInstanceConfig()).toThrow(
          /models\[broken-model\]\.systemPromptFile/,
        );
        expect(() => loadInstanceConfig()).not.toThrow(/server-only-model-id/);
      },
    );
  });

  it('resolves an optional per-model compactionThresholdTokens', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "models": [{ "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000, "compactionThresholdTokens": 300 }]
    }`);
    expect(loadInstanceConfig().models[0].compactionThresholdTokens).toBe(300);
  });

  it('fails boot naming the dangling reference when defaults.modelId does not match any models[].id', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "models": [{ "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000 }],
      "defaults": { "modelId": "not-configured" }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/defaults\.modelId/);
  });

  it('fails boot naming the dangling reference when titleGenerationModelId does not match any models[].id', () => {
    writeConfig(`{
      "defaults": { "titleGenerationModelId": "not-configured" }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /defaults\.titleGenerationModelId/,
    );
  });

  it('unset default pointers are always valid (no reference check on null)', () => {
    expect(() => loadInstanceConfig()).not.toThrow();
  });

  it('a resolved provider key never appears in a duplicate-id or dangling-reference error', () => {
    writeConfig(`{
      "providers": [
        { "id": "openai", "type": "openai", "key": "sk-should-never-leak" },
        { "id": "openai", "type": "openai", "key": "sk-should-never-leak" }
      ]
    }`);
    try {
      loadInstanceConfig();
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('sk-should-never-leak');
    }
  });

  it('a dangling defaults.modelId error never contains the resolved (secret-sourced) value', () => {
    const secretFile = path.join(tmpDir, 'model-id.secret');
    writeFileSync(secretFile, 'sk-should-never-appear-either');
    writeConfig(
      `{ "defaults": { "modelId": "{path:${secretFile.replace(/\\/g, '\\\\')}}" } }`,
    );
    try {
      loadInstanceConfig();
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).not.toContain(
        'sk-should-never-appear-either',
      );
    }
  });
});

describe('loadInstanceConfig — no secret in logs', () => {
  it('a coercion failure alongside an already-resolved sibling secret never leaks the secret', () => {
    // http.trustProxy resolves before runs.* in loadInstanceConfig's assembly
    // order, so the secret below is already resolved in memory by the time
    // the runs.timeoutSeconds coercion throws. (Not routed through
    // defaults.modelId here — providers-and-models-as-code, #167, boot-
    // validates that pointer against models[], which would throw earlier for
    // an unrelated reason and stop exercising this coercion-failure path.)
    process.env.RUN_TIMEOUT_SECONDS_SRC = 'garbage';
    const secretFile = path.join(tmpDir, 'openai.secret');
    writeFileSync(secretFile, 'sk-should-never-appear-in-any-error');
    writeConfig(`{
      "http": { "trustProxy": "{path:${secretFile.replace(/\\/g, '\\\\')}}" },
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
