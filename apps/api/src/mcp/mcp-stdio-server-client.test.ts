import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpServerClient } from './mcp-server-client';
import {
  BoundedReadBuffer,
  BoundedStdioTransport,
  DiagnosticBuffer,
  MAX_DIAGNOSTIC_CHARS,
  MAX_STDIO_MESSAGE_BYTES,
  McpStdioMessageLimitError,
} from './mcp-stdio-transport';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

const FIXTURE = join(__dirname, 'mcp-stdio-test-fixture.mjs');

const TOOL = {
  name: 'lookup',
  description: 'Looks something up.',
  inputSchema: { type: 'object', properties: {} },
};

type FixtureConfig = UnknownRecord;

function connect(
  config: FixtureConfig,
  overrides: {
    readonly args?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly protectedValues?: ReadonlyArray<string>;
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

      const childEnv: unknown = JSON.parse(readFileSync(envDumpPath, 'utf8'));
      if (!isRecord(childEnv)) {
        throw new Error('Expected the dumped child env to be an object');
      }

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
    const seen: Array<string> = [];
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
    const seen: Array<string> = [];
    const client = await connect(
      { tools: [TOOL], stderrBytes: 200_000 },
      { onDiagnostic: (text) => seen.push(text) },
    );
    await client.discover();
    await client.close();

    // Both halves matter. The cap alone is satisfied by emitting nothing, and
    // a bug that silences the stream entirely once one chunk overruns the
    // budget passes a length-only assertion on an empty array.
    const combined = seen.join('');
    expect(combined.length).toBeGreaterThan(0);
    expect(combined).toContain('AAAA');
    expect(combined.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_CHARS);
  });

  // Driven directly rather than through a child: the drop path needs one
  // chunk larger than the *remaining* room, and pipe buffering would split a
  // blob that size into cap-sized pieces that legitimately consume the budget.
  it('does not let a dropped chunk consume the diagnostic budget', () => {
    const seen: Array<string> = [];
    const buffer = new DiagnosticBuffer([], (text) => seen.push(text));

    buffer.append('early-line\n');
    // No newline anywhere in the remaining room, so there is no cut point that
    // could not fall inside a secret. Dropping it is correct; charging the
    // budget for it is not — that would silence the stream from here on.
    buffer.append('B'.repeat(MAX_DIAGNOSTIC_CHARS));
    buffer.append('later-line\n');

    expect(seen).toContain('early-line');
    expect(seen).toContain('later-line');
  });

  it('redacts a protected value that spans several lines', async () => {
    // `{path:…}` trims only the outer whitespace of a credential file, so a
    // PEM or JSON key reaches the protected set with its newlines intact. No
    // released line ever holds such a value whole.
    const secret = [
      '-----BEGIN PRIVATE KEY-----',
      'c2VjcmV0LWtleS1tYXRlcmlhbC1saW5lLW9uZS1wYWRkaW5n',
      'c2VjcmV0LWtleS1tYXRlcmlhbC1saW5lLXR3by1wYWRkaW5n',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const seen: Array<string> = [];
    const client = await connect(
      {
        tools: [TOOL],
        stderr: [`loaded credential:\n${secret}\ncontinuing\n`],
      },
      { protectedValues: [secret], onDiagnostic: (text) => seen.push(text) },
    );
    await client.discover();
    await client.close();

    const combined = seen.join('\n');
    expect(combined).toContain('loaded credential');
    expect(combined).toContain('continuing');
    for (const line of secret.split('\n')) {
      expect(combined).not.toContain(line);
    }
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

    const argv: unknown = JSON.parse(readFileSync(argvDumpPath, 'utf8'));
    if (!Array.isArray(argv)) {
      throw new Error('Expected the dumped argv to be an array');
    }
    expect(argv).toContain(hostile);
  });

  // Regression: `createMCPClient` installs its own `transport.onclose` to reject
  // in-flight requests. Replacing rather than chaining it made this call hang.
  it('rejects an in-flight call when the child exits', async () => {
    const client = await connect({ tools: [TOOL], exitOnCall: true });
    const discovery = await client.discover();

    const outcome = await discovery.tools[0].execute(
      {},
      { toolCallId: 'c1', messages: [] },
    );
    expect(outcome.result.status).toBe('error');

    await client.close();
  }, 5000);

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

  // A stdio server that floods stdout without ever emitting a newline must
  // not be allowed to grow this process's heap without bound. The fixture
  // writes the flood synchronously at startup, before it can answer
  // `initialize`, so the cap fires during the handshake and the connect
  // attempt itself rejects.
  it('refuses a stdio server that floods stdout without a newline', async () => {
    await expect(
      connect({
        tools: [TOOL],
        stdoutFloodBytes: MAX_STDIO_MESSAGE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('BoundedReadBuffer', () => {
  it('accepts a message exactly at the byte cap and strips CRLF framing', () => {
    const line = Buffer.from(
      '{"jsonrpc":"2.0","id":1,"result":{}}\r\n',
      'utf8',
    );
    const buffer = new BoundedReadBuffer(line.length);

    buffer.append(line);

    expect(buffer.readMessage()).toMatchObject({ id: 1 });
    expect(buffer.readMessage()).toBeNull();
  });

  it('parses a message under the cap', () => {
    const buffer = new BoundedReadBuffer(MAX_STDIO_MESSAGE_BYTES);
    buffer.append(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    expect(buffer.readMessage()).toMatchObject({ id: 1 });
  });

  // Cap-check runs before the concat, so an oversized single write is refused
  // at ~cap + one chunk of peak memory rather than after allocating the
  // oversized buffer once.
  it('throws before accumulating past the cap', () => {
    const buffer = new BoundedReadBuffer(16);
    buffer.append(Buffer.from('01234567'));
    expect(() => buffer.append(Buffer.from('890123456789'))).toThrow(
      McpStdioMessageLimitError,
    );
  });

  it('stays failed after exceeding the cap', () => {
    const buffer = new BoundedReadBuffer(8);

    expect(() => buffer.append(Buffer.from('012345678'))).toThrow(
      McpStdioMessageLimitError,
    );
    buffer.clear();

    expect(() => buffer.append(Buffer.from('{}\n'))).toThrow(
      McpStdioMessageLimitError,
    );
  });

  it('accumulates across chunks up to the cap without a newline', () => {
    const buffer = new BoundedReadBuffer(16);
    buffer.append(Buffer.from('0123'));
    buffer.append(Buffer.from('4567'));
    expect(buffer.readMessage()).toBeNull();
  });

  it('applies the cap to each newline-delimited message', () => {
    const buffer = new BoundedReadBuffer(40);
    const message = '{"jsonrpc":"2.0","method":"x"}\n';
    buffer.append(Buffer.from(message.repeat(3)));

    expect(buffer.readMessage()).toMatchObject({ method: 'x' });
    expect(buffer.readMessage()).toMatchObject({ method: 'x' });
    expect(buffer.readMessage()).toMatchObject({ method: 'x' });
  });
});

describe('DiagnosticBuffer protected fragments', () => {
  it('accepts an unterminated chunk exactly at the diagnostic cap', () => {
    const seen: Array<string> = [];
    const buffer = new DiagnosticBuffer([], (text) => seen.push(text));

    buffer.append('x'.repeat(MAX_DIAGNOSTIC_CHARS));
    buffer.flush();

    expect(seen).toEqual(['x'.repeat(MAX_DIAGNOSTIC_CHARS)]);
  });

  it('redacts eight-character lines but leaves shorter fragments visible', () => {
    const secret = ['short', '12345678'].join('\n');
    const seen: Array<string> = [];
    const buffer = new DiagnosticBuffer([secret], (text) => seen.push(text));

    buffer.append(`${secret}\n`);

    const output = seen.join('');
    expect(output).toContain('short');
    expect(output).not.toContain('12345678');
  });
});

describe('BoundedStdioTransport lifecycle', () => {
  it('rejects sends before start and duplicate starts', async () => {
    const transport = new BoundedStdioTransport({
      command: process.execPath,
      args: ['-e', 'process.stdin.resume()'],
    });

    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    ).rejects.toThrow('Not connected');
    await expect(transport.close()).resolves.toBeUndefined();

    await transport.start();
    await expect(transport.start()).rejects.toThrow(
      'BoundedStdioTransport already started!',
    );
    await transport.close();
  });
});
