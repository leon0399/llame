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

import { InstanceConfigError } from '@workspace/config-interpolation';
import {
  renderSystemPromptTemplate,
  type TemporalAnchor,
} from './prompt-loader';

const TEST_ANCHOR: TemporalAnchor = {
  systemTime: '2000-01-01 00:00+00:00',
  systemTimezone: 'UTC',
};
import { loadInstanceConfig, resolveConfigPath } from './config-loader';
import { BUILT_IN_DEFAULTS } from './llame-config';

/** Narrows a `catch`-clause `unknown` to its message without a cast; fails the test loudly if the caught value is not an `Error`. */
function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    throw new Error(`expected an Error instance, got ${String(err)}`);
  }
  return err.message;
}

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

function renderFirstModel(): string {
  const model = loadInstanceConfig().models[0];
  return renderSystemPromptTemplate({
    template: model.systemPromptTemplate,
    model,
    anchor: TEST_ANCHOR,
  });
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
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain(file);
      expect(errorMessage(error)).toMatch(/line \d+, column \d+/);
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
      `{ "defaults": { "modelId": "{path:${secretFile.replaceAll('\\', String.raw`\\`)}}" }, ${modelFixtureJson('system:openai:gpt-5.4-mini')} }`,
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
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain(missing);
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

  it('rejects wildcard rules for code-owned tools', () => {
    writeConfig('{ "tools": { "allowed": ["conversation_*"] } }');
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/tools\.allowed/);
    expect(() => loadInstanceConfig()).toThrow(/conversation_\*/);
  });

  it('accepts the exact conversation_read code-owned id', () => {
    writeConfig('{ "tools": { "allowed": ["conversation_read"] } }');
    expect(loadInstanceConfig().tools.allowed).toEqual(['conversation_read']);
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

describe('loadInstanceConfig — mcpServers (add-streamable-http-mcp-tools 4.1–4.3)', () => {
  it('defaults the server map to empty when mcpServers is absent', () => {
    expect(loadInstanceConfig().mcpServers).toEqual({});
  });

  it.each(['http', 'streamable-http'] as const)(
    'maps the %s alias to Streamable HTTP and resolves private headers',
    (type) => {
      const secretFile = path.join(tmpDir, 'mcp-token.secret');
      writeFileSync(secretFile, 'path-token');
      writeConfig(`{
        "mcpServers": {
          "Web_Server-1": {
            "type": ${JSON.stringify(type)},
            "url": "https://example.test/mcp",
            "headers": {
              "Authorization": "Bearer {env:MCP_TOKEN}",
              "X-Path-Token": "{path:${secretFile.replaceAll('\\', String.raw`\\`)}}"
            }
          }
        }
      }`);

      expect(loadInstanceConfig({ MCP_TOKEN: 'env-token' }).mcpServers).toEqual(
        {
          'Web_Server-1': {
            type: 'streamable-http',
            url: 'https://example.test/mcp',
            headers: {
              Authorization: 'Bearer env-token',
              'X-Path-Token': 'path-token',
            },
          },
        },
      );
    },
  );

  it('retains __proto__ as an own enumerable header without giving resolved headers a prototype', () => {
    writeConfig(`{
      "mcpServers": {
        "web": {
          "type": "http",
          "url": "https://example.test/mcp",
          "headers": { "__proto__": "header-value" }
        }
      }
    }`);

    const web = loadInstanceConfig().mcpServers.web;
    expect(web.type).toBe('streamable-http');
    const headers = web.type === 'stdio' ? undefined : web.headers;
    expect(headers).toBeDefined();
    expect(Object.getPrototypeOf(headers)).toBeNull();
    expect(Object.hasOwn(headers!, '__proto__')).toBe(true);
    expect(Object.keys(headers!)).toContain('__proto__');
    expect(headers!.__proto__).toBe('header-value');
  });

  it('rejects the noncanonical top-level servers alias', () => {
    writeConfig(`{
      "servers": {
        "web": { "type": "http", "url": "https://example.test/mcp" }
      }
    }`);

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/servers/);
  });

  it('interpolates the private URL and stores only its resolved config value', () => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "{env:MCP_URL}" }
      }
    }`);

    const web = loadInstanceConfig({ MCP_URL: 'https://example.test/mcp' })
      .mcpServers.web;
    expect(web.type === 'stdio' ? undefined : web.url).toBe(
      'https://example.test/mcp',
    );
  });

  it('rejects a resolved credential-bearing URL without disclosing it', () => {
    const secretUrl = 'https://user:secret@example.test/mcp';
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "{env:MCP_URL}" }
      }
    }`);

    try {
      loadInstanceConfig({ MCP_URL: secretUrl });
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain('mcpServers.web.url');
      expect(errorMessage(error)).not.toContain(secretUrl);
      expect(errorMessage(error)).not.toContain('secret');
    }
  });

  it('loads a stdio entry and derives protected values from its tokens only', () => {
    writeConfig(`{
      "mcpServers": {
        "local": {
          "type": "stdio",
          "command": "docker",
          "args": [
            "run", "-i", "--rm",
            "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
            "ghcr.io/github/github-mcp-server", "--read-only",
            "--vault", "/srv/data"
          ],
          "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GH_PAT}" },
          "cwd": "/opt/llame"
        }
      }
    }`);

    const local = loadInstanceConfig({ GH_PAT: 'ghp_secret_value' }).mcpServers
      .local;
    expect(local.type).toBe('stdio');
    if (local.type !== 'stdio') expect.unreachable('expected a stdio entry');

    expect(local.command).toBe('docker');
    expect(local.args).toContain('--read-only');
    expect(local.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_secret_value');
    expect(local.cwd).toBe('/opt/llame');

    // Only the interpolated value is protected. Literal args — including a
    // low-entropy path — must not be, or every tool call naming that path
    // would be refused and every result mentioning it corrupted.
    expect(local.protectedValues).toEqual(['ghp_secret_value']);
  });

  it('forwards an env variable named __proto__ instead of dropping it', () => {
    // The schema permits any non-empty variable name. Assigning this one into
    // a normal object reaches `Object.prototype`'s setter, so the variable
    // vanishes with no error anywhere for the operator to see.
    writeConfig(`{
      "mcpServers": {
        "odd": {
          "type": "stdio",
          "command": "odd-mcp",
          "env": { "__proto__": "literal-value" }
        }
      }
    }`);

    const odd = loadInstanceConfig({}).mcpServers.odd;
    if (odd.type !== 'stdio') expect.unreachable('expected a stdio entry');
    const { env } = odd;
    if (env === undefined) expect.unreachable('expected a declared env');

    expect(Object.hasOwn(env, '__proto__')).toBe(true);
    expect(env['__proto__']).toBe('literal-value');
  });

  it('protects only the substituted segment of a partly interpolated field', () => {
    writeConfig(`{
      "mcpServers": {
        "notes": {
          "type": "stdio",
          "command": "notes-mcp",
          "args": ["--auth", "Bearer {env:NOTES_KEY}"]
        }
      }
    }`);

    const notes = loadInstanceConfig({ NOTES_KEY: 'nk_9f8e' }).mcpServers.notes;
    if (notes.type !== 'stdio') expect.unreachable('expected a stdio entry');

    expect(notes.args).toEqual(['--auth', 'Bearer nk_9f8e']);
    // The token, not the whole argument: a server echoing the bare secret
    // must still be recognized.
    expect(notes.protectedValues).toEqual(['nk_9f8e']);
  });

  // A bare `oneOf` of two closed schemas reports both branches' failures, so a
  // typo'd stdio entry was told to add a `url`. The schema keys on `type` so
  // only the matching branch is validated.
  it('reports a stdio typo against the stdio branch only', () => {
    writeConfig(`{
      "mcpServers": {
        "local": { "type": "stdio", "command": "server", "shell": true }
      }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      const message = errorMessage(error);
      expect(message).toContain('shell');
      // Never advice from the wrong branch.
      expect(message).not.toContain('url');
      expect(message).not.toContain('streamable-http');
    }
  });

  it('applies server-name rules to a stdio entry', () => {
    writeConfig(`{
      "mcpServers": { "bad__name": { "type": "stdio", "command": "server" } }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails a stdio interpolation without printing the value', () => {
    writeConfig(`{
      "mcpServers": {
        "local": {
          "type": "stdio",
          "command": "server",
          "env": { "TOKEN": "{env:MISSING_STDIO_SECRET}" }
        }
      }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain('mcpServers.local.env.TOKEN');
      expect(errorMessage(error)).not.toContain('MISSING_STDIO_SECRET=');
    }
  });

  it.each([
    [
      'legacy SSE transport',
      '"type": "sse", "url": "https://example.test/mcp"',
    ],
    ['unknown transport', '"type": "ws", "url": "https://example.test/mcp"'],
    [
      'a stdio field on a remote entry',
      '"type": "http", "url": "https://example.test/mcp", "command": "server"',
    ],
    [
      'a remote field on a stdio entry',
      '"type": "stdio", "command": "server", "url": "https://example.test/mcp"',
    ],
    ['a stdio entry without a command', '"type": "stdio"'],
    ['an empty stdio command', '"type": "stdio", "command": ""'],
    [
      'a non-string stdio argument',
      '"type": "stdio", "command": "server", "args": [1]',
    ],
    [
      'an unknown stdio field',
      '"type": "stdio", "command": "server", "shell": true',
    ],
  ])('rejects %s', (_case, entry) => {
    writeConfig(`{ "mcpServers": { "web": { ${entry} } } }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/mcpServers/);
  });

  it.each([
    [
      'top-level properties',
      '{ "tools": {}, "tools": { "allowed": [] } }',
      'tools',
    ],
    [
      'server properties',
      '{ "mcpServers": { "web": { "type": "http", "url": "https://one.test/mcp" }, "web": { "type": "http", "url": "https://two.test/mcp" } } }',
      'mcpServers.web',
    ],
    [
      'nested header properties',
      '{ "mcpServers": { "web": { "type": "http", "url": "https://example.test/mcp", "headers": { "Authorization": "first", "Authorization": "second" } } } }',
      'mcpServers.web.headers.Authorization',
    ],
  ])('rejects duplicate JSONC %s before overwrite', (_case, source, path) => {
    writeConfig(source);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(path);
  });

  it('rejects ASCII-case-fold-colliding configured headers without values', () => {
    writeConfig(`{
      "mcpServers": {
        "web": {
          "type": "http",
          "url": "https://example.test/mcp",
          "headers": {
            "Authorization": "first-secret",
            "authorization": "second-secret"
          }
        }
      }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain(
        'mcpServers.web.headers.Authorization',
      );
      expect(errorMessage(error)).toContain(
        'mcpServers.web.headers.authorization',
      );
      expect(errorMessage(error)).not.toContain('first-secret');
      expect(errorMessage(error)).not.toContain('second-secret');
    }
  });

  it.each([
    'accept',
    'CONTENT-TYPE',
    'Mcp-Protocol-Version',
    'mcp-session-id',
    'LAST-EVENT-ID',
  ])('rejects transport-owned header %s case-insensitively', (header) => {
    writeConfig(`{
      "mcpServers": {
        "web": {
          "type": "http",
          "url": "https://example.test/mcp",
          "headers": { ${JSON.stringify(header)}: "header-secret" }
        }
      }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain(`mcpServers.web.headers.${header}`);
      expect(errorMessage(error)).not.toContain('header-secret');
    }
  });

  it.each([
    ['reserved separator', 'bad__server'],
    ['non-ASCII-safe character', 'bad/server'],
    ['empty name', ''],
    ['too long for a 64-character tool id', 's'.repeat(57)],
  ])('rejects a %s server name', (_case, serverId) => {
    writeConfig(`{
      "mcpServers": {
        ${JSON.stringify(serverId)}: {
          "type": "http",
          "url": "https://example.test/mcp"
        }
      }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/mcpServers/);
  });

  it.each([
    ['relative URL', '/mcp'],
    ['unsupported scheme', 'ftp://example.test/mcp'],
    ['credential-bearing username', 'https://user@example.test/mcp'],
    ['credential-bearing password', 'https://user:password@example.test/mcp'],
  ])('rejects a %s without disclosing the URL', (_case, url) => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": ${JSON.stringify(url)} }
      }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).toContain('mcpServers.web.url');
      expect(errorMessage(error)).not.toContain(url);
    }
  });

  it.each([
    ['empty name', '{ "": "value" }'],
    ['empty value', '{ "X-Token": "" }'],
    ['interpolated empty value', '{ "X-Token": "{env:EMPTY_TOKEN:-}" }'],
  ])('rejects a header with %s', (_case, headers) => {
    writeConfig(`{
      "mcpServers": {
        "web": {
          "type": "http",
          "url": "https://example.test/mcp",
          "headers": ${headers}
        }
      }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/mcpServers/);
  });

  it.each(['Bad Header', 'X:Bad', 'X\nInjected'])(
    'rejects invalid HTTP header name %j without disclosing its value',
    (header) => {
      writeConfig(`{
        "mcpServers": {
          "web": {
            "type": "http",
            "url": "https://example.test/mcp",
            "headers": { ${JSON.stringify(header)}: "header-secret" }
          }
        }
      }`);

      try {
        loadInstanceConfig();
        expect.unreachable('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceConfigError);
        expect(errorMessage(error)).toContain('/mcpServers/web/headers');
        expect(errorMessage(error)).not.toContain('header-secret');
      }
    },
  );

  it('keeps canonical allowlisted MCP ids for a configured offline server', () => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "https://offline.test/mcp" }
      },
      "tools": { "allowed": ["mcp__web__Find_Docs"] }
    }`);
    expect(loadInstanceConfig().tools.allowed).toEqual(['mcp__web__Find_Docs']);
  });

  it('accepts the canonical namespace wildcard for a configured offline server', () => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "https://offline.test/mcp" }
      },
      "tools": { "allowed": ["mcp__web__*"] }
    }`);
    expect(loadInstanceConfig().tools.allowed).toEqual(['mcp__web__*']);
  });

  it.each([
    '*',
    'mcp__web*',
    'mcp__web__search*',
    'mcp__web__*__search',
    'mcp__web__**',
    'mcp__*__*',
    'mcp_web__*',
    'mcp__bad.server__*',
    'mcp__missing__*',
  ])('rejects a malformed or undeclared MCP namespace wildcard %s', (id) => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "https://offline.test/mcp" }
      },
      "tools": { "allowed": [${JSON.stringify(id)}] }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/tools\.allowed/);
    expect(() => loadInstanceConfig()).toThrow(id);
  });

  it.each([
    ['malformed', 'mcp__web'],
    ['noncanonical', 'mcp__web__Find Docs'],
    ['overlength', `mcp__web__${'a'.repeat(55)}`],
    ['undeclared server', 'mcp__missing__search'],
  ])('rejects a %s MCP allowlist id', (_case, id) => {
    writeConfig(`{
      "mcpServers": {
        "web": { "type": "http", "url": "https://offline.test/mcp" }
      },
      "tools": { "allowed": [${JSON.stringify(id)}] }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/tools\.allowed/);
    expect(() => loadInstanceConfig()).toThrow(id);
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
    // `all` keeps search-reindex/sessions-cleanup/search-embed at their
    // built-in 1; only runs is overridden — the footgun fix (a wholesale
    // replace would have silently disabled the other groups instance-wide).
    expect(config.workers.all).toEqual({
      runs: 4,
      'search-reindex': 1,
      'sessions-cleanup': 1,
      'search-embed': 1,
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
      contextWindowTokens: 400_000,
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
      writePrompt('Relative prompt for {{model.id}}\n', 'prompts/model.md');
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

      const model = loadInstanceConfig().models[0];
      expect(model).toMatchObject({ systemPromptSource: 'model_override' });
      expect(
        renderSystemPromptTemplate({
          template: model.systemPromptTemplate,
          model,
          anchor: TEST_ANCHOR,
        }),
      ).toBe('Relative prompt for m');
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

      const model = loadInstanceConfig().models[0];
      expect(model).toMatchObject({ systemPromptSource: 'model_override' });
      expect(
        renderSystemPromptTemplate({
          template: model.systemPromptTemplate,
          model,
          anchor: TEST_ANCHOR,
        }),
      ).toBe('Absolute prompt');
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

      expect(renderFirstModel()).toBe('alpha  \nbeta\t\nthird');
    });

    it('renders the exact id, name, and literal-name escape surface in an override', () => {
      writePrompt(
        String.raw`id {{model.id}} name {{model.name}} literal \{{model.name}}`,
        'override.md',
      );
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

      expect(renderFirstModel()).toBe(
        'id model-id name Model Name literal {{model.name}}',
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
      expect(
        renderSystemPromptTemplate({
          template: model.systemPromptTemplate,
          model,
          anchor: TEST_ANCHOR,
        }),
      ).toMatch(/\S/);
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
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain('sk-should-never-leak');
    }
  });

  it('a dangling defaults.modelId error never contains the resolved (secret-sourced) value', () => {
    const secretFile = path.join(tmpDir, 'model-id.secret');
    writeFileSync(secretFile, 'sk-should-never-appear-either');
    writeConfig(
      `{ "defaults": { "modelId": "{path:${secretFile.replaceAll('\\', String.raw`\\`)}}" } }`,
    );
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain(
        'sk-should-never-appear-either',
      );
    }
  });
});

describe('loadInstanceConfig — embeddingModels[] / search.* (chat-search-embeddings, task 5.1)', () => {
  it('resolves a valid embedding model and per-corpus selection', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "text-embedding-3-small", "dimensions": 1536 }
      ],
      "search": { "chats": { "embeddingModelId": "e" } }
    }`);
    const config = loadInstanceConfig();
    expect(config.embeddingModels).toHaveLength(1);
    expect(config.embeddingModels[0]).toMatchObject({
      id: 'e',
      provider: 'p',
      providerModelId: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 32,
      distanceMetric: 'cosine',
    });
    expect(config.search.chats.embeddingModelId).toBe('e');
  });

  it('defaults batchSize and distanceMetric off unedited config, and omits optional fields', () => {
    expect(loadInstanceConfig().embeddingModels).toEqual([]);
    expect(loadInstanceConfig().search).toEqual({
      chats: { embeddingModelId: null },
    });
  });

  it('rejects the removed canonical model excerpt activation key', () => {
    writeConfig(
      '{ "search": { "chats": { "canonicalModelExcerpts": true } } }',
    );

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('resolves batchSize/distanceMetric/revision/prefixes when set', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        {
          "id": "e", "provider": "p", "providerModelId": "m", "dimensions": 8,
          "batchSize": 16, "distanceMetric": "cosine", "revision": "v2",
          "documentPrefix": "passage: ", "queryPrefix": "query: "
        }
      ]
    }`);
    expect(loadInstanceConfig().embeddingModels[0]).toMatchObject({
      batchSize: 16,
      distanceMetric: 'cosine',
      revision: 'v2',
      documentPrefix: 'passage: ',
      queryPrefix: 'query: ',
    });
  });

  it('rejects a duplicate embedding model id', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "m1", "dimensions": 8 },
        { "id": "e", "provider": "p", "providerModelId": "m2", "dimensions": 8 }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /duplicate embedding model id "e"/,
    );
  });

  it('fails boot naming the embedding model id and the dangling reference when embeddingModels[].provider is unknown', () => {
    writeConfig(`{
      "embeddingModels": [
        { "id": "e", "provider": "ghost", "providerModelId": "m", "dimensions": 8 }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /embeddingModels\[e\]\.provider/,
    );
    expect(() => loadInstanceConfig()).toThrow(/"ghost"/);
  });

  it('fails schema validation when dimensions is non-positive', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "m", "dimensions": 0 }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails schema validation when batchSize is non-positive', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "m", "dimensions": 8, "batchSize": 0 }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails schema validation on an unsupported distanceMetric', () => {
    writeConfig(`{
      ${SINGLE_PROVIDER_JSON},
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "m", "dimensions": 8, "distanceMetric": "euclidean" }
      ]
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails boot naming the dangling reference when search.chats.embeddingModelId does not match any embeddingModels[].id', () => {
    writeConfig(`{
      "search": { "chats": { "embeddingModelId": "not-configured" } }
    }`);
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /search\.chats\.embeddingModelId/,
    );
  });

  it('a self-hosted keyless local provider needs no new configuration concept', () => {
    writeConfig(`{
      "providers": [{ "id": "local", "type": "openai", "baseUrl": "http://localhost:11434/v1" }],
      "embeddingModels": [
        { "id": "e", "provider": "local", "providerModelId": "bge-m3", "dimensions": 1024 }
      ]
    }`);
    expect(loadInstanceConfig().embeddingModels[0].provider).toBe('local');
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
      "http": { "trustProxy": "{path:${secretFile.replaceAll('\\', String.raw`\\`)}}" },
      "runs": { "timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS_SRC}" }
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain(
        'sk-should-never-appear-in-any-error',
      );
    }
    delete process.env.RUN_TIMEOUT_SECONDS_SRC;
  });

  it('a resolved embedding-provider credential never appears in a duplicate-id, dangling-reference, or binding error (extends the models[] redaction coverage for embeddingModels[])', () => {
    writeConfig(`{
      "providers": [{ "id": "p", "type": "openai", "key": "sk-embed-should-never-leak" }],
      "embeddingModels": [
        { "id": "e", "provider": "p", "providerModelId": "m1", "dimensions": 8 },
        { "id": "e", "provider": "p", "providerModelId": "m2", "dimensions": 8 }
      ]
    }`);
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain('sk-embed-should-never-leak');
    }
  });

  it('a dangling search.chats.embeddingModelId error never contains a resolved (secret-sourced) value', () => {
    const secretFile = path.join(tmpDir, 'embedding-model-id.secret');
    writeFileSync(secretFile, 'sk-embed-should-never-appear-either');
    const escapedPath = secretFile.replaceAll('\\', String.raw`\\`);
    writeConfig(
      `{ "search": { "chats": { "embeddingModelId": "{path:${escapedPath}}" } } }`,
    );
    try {
      loadInstanceConfig();
      expect.unreachable('expected throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain(
        'sk-embed-should-never-appear-either',
      );
    }
  });
});

describe('loadInstanceConfig — models[].reasoning (add-reasoning-effort)', () => {
  const model = (reasoning: string) =>
    `{
      ${SINGLE_PROVIDER_JSON},
      "models": [{
        "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000,
        "reasoning": ${reasoning}
      }]
    }`;

  it('resolves a declared effort vocabulary and defaults the cache flag to false', () => {
    writeConfig(
      model('{ "effortLevels": ["low", "high"], "defaultEffort": "high" }'),
    );
    expect(loadInstanceConfig().models[0]?.reasoning).toEqual({
      effortLevels: [{ value: 'low' }, { value: 'high' }],
      defaultEffort: 'high',
      cacheInvalidatedByEffortChange: false,
    });
  });

  it('carries an explicit cache flag through', () => {
    writeConfig(
      model(
        '{ "effortLevels": ["low"], "defaultEffort": "low", "cacheInvalidatedByEffortChange": true }',
      ),
    );
    expect(
      loadInstanceConfig().models[0]?.reasoning?.cacheInvalidatedByEffortChange,
    ).toBe(true);
  });

  it('omits reasoning entirely for a model that declares none', () => {
    writeConfig(
      `{ ${SINGLE_PROVIDER_JSON}, "models": [{ "id": "m", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000 }] }`,
    );
    expect(loadInstanceConfig().models[0]).not.toHaveProperty('reasoning');
  });

  // Levels are opaque PROVIDER tokens: llame constrains nothing about their
  // text, because every provider disagrees on the vocabulary and changes it
  // between releases. Casing, separators, and order all survive verbatim.
  it('accepts arbitrary level text and preserves authored order', () => {
    writeConfig(
      model(
        '{ "effortLevels": ["MAX", "very-high", "effort_2", "none"], "defaultEffort": "none" }',
      ),
    );
    expect(loadInstanceConfig().models[0]?.reasoning?.effortLevels).toEqual([
      { value: 'MAX' },
      { value: 'very-high' },
      { value: 'effort_2' },
      { value: 'none' },
    ]);
  });

  it('normalizes a mixed bare-string and labeled array', () => {
    writeConfig(
      model(
        '{ "effortLevels": ["none", { "value": "xhigh", "label": "Extra High" }, "max"], "defaultEffort": "none" }',
      ),
    );
    expect(loadInstanceConfig().models[0]?.reasoning?.effortLevels).toEqual([
      { value: 'none' },
      { value: 'xhigh', label: 'Extra High' },
      { value: 'max' },
    ]);
  });

  it('rejects a labeled object missing label', () => {
    writeConfig(
      model('{ "effortLevels": [{ "value": "low" }], "defaultEffort": "low" }'),
    );
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning\/effortLevels\/0/,
    );
  });

  it('rejects a whitespace-only label', () => {
    writeConfig(
      model(
        '{ "effortLevels": [{ "value": "low", "label": "  " }], "defaultEffort": "low" }',
      ),
    );
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\.reasoning\.effortLevels\[0\]\.label: must not be blank/,
    );
  });

  it('rejects a defaultEffort absent from effortLevels, naming the model', () => {
    writeConfig(
      model('{ "effortLevels": ["low", "high"], "defaultEffort": "medium" }'),
    );
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\.reasoning\.defaultEffort: "medium" is not one of effortLevels \[low, high\]/,
    );
  });

  // Case-sensitivity is a consequence of "no normalization", not a rule of its
  // own — an operator who writes "High" as the default gets a boot failure
  // rather than a silent fold onto "high".
  it('rejects a defaultEffort differing only by case', () => {
    writeConfig(model('{ "effortLevels": ["high"], "defaultEffort": "High" }'));
    expect(() => loadInstanceConfig()).toThrow(
      /reasoning\.defaultEffort: "High" is not one of/,
    );
  });

  it('rejects a missing defaultEffort rather than implying one', () => {
    writeConfig(model('{ "effortLevels": ["low", "high"] }'));
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning: must have required property 'defaultEffort'/,
    );
  });

  it('rejects an empty effortLevels', () => {
    writeConfig(model('{ "effortLevels": [], "defaultEffort": "low" }'));
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning\/effortLevels: must NOT have fewer than 1 items/,
    );
  });

  it('rejects a duplicate value', () => {
    writeConfig(
      model('{ "effortLevels": ["low", "low"], "defaultEffort": "low" }'),
    );
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\.reasoning\.effortLevels\[1\]: duplicate value "low"/,
    );
  });

  it('rejects a duplicate value across bare string and object forms', () => {
    writeConfig(
      model(
        '{ "effortLevels": ["low", { "value": "low", "label": "Low" }], "defaultEffort": "low" }',
      ),
    );
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\.reasoning\.effortLevels\[1\]: duplicate value "low"/,
    );
  });

  it('rejects a blank level', () => {
    writeConfig(
      model('{ "effortLevels": ["low", ""], "defaultEffort": "low" }'),
    );
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning\/effortLevels\/1/,
    );
  });

  it('rejects a whitespace-only level, which minLength:1 alone would admit', () => {
    writeConfig(
      model('{ "effortLevels": ["low", "  "], "defaultEffort": "low" }'),
    );
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\.reasoning\.effortLevels\[1\]: must not be blank/,
    );
  });

  // Guards the blank check against being "fixed" into a trim: padding makes an
  // odd provider token, not an invalid one, and must survive byte-for-byte.
  it('keeps a padded but nonblank level verbatim', () => {
    writeConfig(
      model('{ "effortLevels": [" low "], "defaultEffort": " low " }'),
    );
    expect(loadInstanceConfig().models[0]?.reasoning).toMatchObject({
      effortLevels: [{ value: ' low ' }],
      defaultEffort: ' low ',
    });
  });

  it('rejects the retired boolean form, naming the model', () => {
    writeConfig(model('true'));
    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning: must be object/,
    );
  });

  it('rejects an unknown key inside the reasoning object', () => {
    writeConfig(
      model(
        '{ "effortLevels": ["low"], "defaultEffort": "low", "available": true }',
      ),
    );
    expect(() => loadInstanceConfig()).toThrow(
      /models\[m\]\/reasoning\/available: unrecognized key/,
    );
  });

  // The id-bearing path is a general improvement to models[] schema errors,
  // so it must degrade gracefully for the entry whose own `id` is the problem.
  it('falls back to the positional path when the entry has no usable id', () => {
    writeConfig(
      `{ ${SINGLE_PROVIDER_JSON}, "models": [{ "id": "", "provider": "p", "providerModelId": "x", "contextWindowTokens": 1000 }] }`,
    );
    expect(() => loadInstanceConfig()).toThrow(
      /\/models\/0\/id: must NOT have fewer than 1 characters/,
    );
  });
});
