import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpServerClient } from './mcp-server-client';
import { MAX_DIAGNOSTIC_CHARS } from './mcp-stdio-transport';

const FIXTURE = join(__dirname, 'mcp-stdio-test-fixture.mjs');

const TOOL = {
  name: 'lookup',
  description: 'Looks something up.',
  inputSchema: { type: 'object', properties: {} },
};

type FixtureConfig = Record<string, unknown>;

function connect(
  config: FixtureConfig,
  overrides: {
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly protectedValues?: readonly string[];
    readonly onDisconnect?: () => void;
    readonly onDiagnostic?: (text: string) => void;
  } = {},
) {
  const { args = [], env = {}, ...rest } = overrides;
  return McpServerClient.connectStdio({
    serverId: 'local',
    command: process.execPath,
    args: [FIXTURE, ...args],
    env: { ...env, MCP_FIXTURE: JSON.stringify(config) },
    ...rest,
  });
}

function scratchFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'mcp-stdio-')), name);
}

describe('McpServerClient.connectStdio', () => {
  afterEach(() => vi.unstubAllEnvs());

  // Task 1.5
  it('connects, discovers, executes a tool, and closes', async () => {
    const client = await connect({
      tools: [TOOL],
      callResult: { content: [{ type: 'text', text: 'answer' }] },
    });
    try {
      const discovery = await client.discover();
      expect(discovery.tools.map((entry) => entry.definition.id)).toEqual([
        'mcp__local__lookup',
      ]);

      const outcome = await discovery.tools[0].execute(
        {},
        { toolCallId: 'call-1', messages: [] },
      );
      expect(outcome.result.status).toBe('success');
    } finally {
      await client.close();
    }
  });

  // Task 1.6 — the base allowlist is inherited, everything else is not.
  it('gives the child the declared env over the SDK base allowlist only', async () => {
    const envDumpPath = scratchFile('env.json');
    vi.stubEnv('SHELL', '/bin/from-parent');
    vi.stubEnv('LLAME_STDIO_TEST_SECRET', 'must-not-leak');
    vi.stubEnv('TERM', undefined);

    {
      const client = await connect(
        { tools: [TOOL], envDumpPath },
        { env: { DECLARED_ONLY: 'declared-value', USER: 'declared-user' } },
      );
      await client.close();

      const childEnv = JSON.parse(readFileSync(envDumpPath, 'utf8')) as Record<
        string,
        string
      >;

      // Defined allowlist variable is inherited without being declared.
      expect(childEnv.SHELL).toBe('/bin/from-parent');
      // A declared value wins over the inherited one.
      expect(childEnv.USER).toBe('declared-user');
      // Declared non-allowlist variable is present.
      expect(childEnv.DECLARED_ONLY).toBe('declared-value');
      // Undefined allowlist variable is not fabricated.
      expect(childEnv.TERM).toBeUndefined();
      // Anything else llame holds stays out of the child.
      expect(childEnv.LLAME_STDIO_TEST_SECRET).toBeUndefined();
    }
  });

  // `cwd` is a shipped transport option; without this it had no coverage.
  it('runs the child in the configured working directory', async () => {
    const cwdDumpPath = scratchFile('cwd.txt');
    const cwd = mkdtempSync(join(tmpdir(), 'mcp-stdio-cwd-'));
    const client = await connect({ tools: [TOOL], cwdDumpPath }, { cwd });
    await client.close();

    expect(readFileSync(cwdDumpPath, 'utf8')).toBe(cwd);
  });

  // Task 1.7 — sanitization against a supplied protected-value set.
  it('sanitizes protected values out of results and refuses them in arguments', async () => {
    const secret = 'ghp_stdio_secret_value';
    const client = await connect(
      {
        tools: [TOOL],
        callResult: {
          content: [{ type: 'text', text: `token ${secret} used` }],
        },
      },
      { protectedValues: [secret] },
    );
    try {
      const discovery = await client.discover();
      const tool = discovery.tools[0];

      const result = await tool.execute({}, { toolCallId: 'c1', messages: [] });
      expect(JSON.stringify(result.result)).not.toContain(secret);

      const rejected = await tool.execute(
        { q: `see ${secret}` },
        { toolCallId: 'c2', messages: [] },
      );
      expect(rejected.result).toMatchObject({
        status: 'error',
        type: 'invalid_input',
      });
    } finally {
      await client.close();
    }
  });

  // Task 1.8 — diagnostics captured before init, sanitized, bounded.
  it('captures pre-initialization diagnostics and redacts protected values', async () => {
    const secret = 'stdio-diagnostic-secret';
    const seen: string[] = [];
    const client = await connect(
      {
        tools: [TOOL],
        stderrPreInit: true,
        stderr: ['starting up, token=', secret, ' done\n'],
        stderrDelayMs: 5,
      },
      { protectedValues: [secret], onDiagnostic: (text) => seen.push(text) },
    );
    await client.close();

    const combined = seen.join('');
    expect(combined).toContain('starting up');
    // Split across chunks, so a naive per-chunk redaction would miss it.
    expect(combined).not.toContain(secret);
  });

  it('bounds retained diagnostic output', async () => {
    const seen: string[] = [];
    const client = await connect(
      { tools: [TOOL], stderrBytes: 200_000 },
      { onDiagnostic: (text) => seen.push(text) },
    );
    await client.discover();
    await client.close();

    expect(seen.join('').length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_CHARS);
  });

  // Task 1.9 — protocol gate.
  it('refuses a revision outside llame’s supported set and stops the child', async () => {
    await expect(
      connect({ tools: [TOOL], protocolVersion: '2024-11-05' }),
    ).rejects.toMatchObject({ name: 'McpProtocolUnsupportedError' });
  });

  // Task 1.10 — post-parse discovery limits still bind.
  it('enforces the post-parse tools-per-page limit', async () => {
    const tools = Array.from({ length: 300 }, (_, index) => ({
      ...TOOL,
      name: `lookup_${index}`,
    }));
    const client = await connect({ tools });
    try {
      await expect(client.discover()).rejects.toMatchObject({
        limit: 'tools_per_page',
      });
    } finally {
      await client.close();
    }
  });

  // Task 1.11 — no shell interpretation.
  it('passes shell metacharacters through as literal arguments', async () => {
    const argvDumpPath = scratchFile('argv.json');
    const hostile = '$(touch /tmp/llame-pwned); echo `whoami` && ls > /tmp/x';
    const client = await connect(
      { tools: [TOOL], argvDumpPath },
      { args: [hostile] },
    );
    await client.close();

    const argv = JSON.parse(readFileSync(argvDumpPath, 'utf8')) as string[];
    expect(argv).toContain(hostile);
  });

  it('reports child exit through onDisconnect', async () => {
    let signalDisconnected!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      signalDisconnected = resolve;
    });
    const client = await connect(
      { tools: [TOOL], exitAfterInit: true },
      { onDisconnect: () => signalDisconnected() },
    );
    await disconnected;
    await client.close();
  });
});
