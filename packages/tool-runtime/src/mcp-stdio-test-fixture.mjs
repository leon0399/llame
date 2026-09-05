// A minimal MCP server speaking newline-framed JSON-RPC over stdin/stdout.
//
// Plain `.mjs` on purpose: the client spawns it with a bare `node`, and vitest's
// swc transform only applies in-process, so a `.ts` fixture would not run.
//
// Behavior is driven entirely by the `MCP_FIXTURE` environment variable holding
// a JSON object, so one script serves every case the client tests need:
//
//   protocolVersion  string   version to report from `initialize`
//   tools            array    tool declarations, or pages: [[...], [...]]
//   callResult       object   result payload for `tools/call`
//   exitOnCall       boolean  exit without answering a `tools/call`, to prove
//                             an in-flight request rejects instead of hanging
//   stderr           array    chunks written to stderr, in order
//   stderrBytes      number   generate one chunk of N bytes internally, so a
//                             large payload never travels through the env var
//   stderrPreInit    boolean  write those chunks before answering `initialize`
//   stderrDelayMs    number   delay between stderr chunks (to force chunk splits)
//   envDumpPath      string   write `process.env` here as JSON, then continue
//   pidDumpPath      string   write process.pid here
//   argvDumpPath     string   write `process.argv.slice(2)` here as JSON
//   cwdDumpPath      string   write `process.cwd()` here
//   exitAfterInit    boolean  exit non-zero once initialized
//   stdoutFloodBytes number   write N newline-free bytes to stdout at
//                             startup, to exercise the client's per-message
//                             byte cap

import { writeFileSync } from 'node:fs';

const config = JSON.parse(process.env.MCP_FIXTURE ?? '{}');

if (config.pidDumpPath) writeFileSync(config.pidDumpPath, String(process.pid), 'utf8');

if (config.envDumpPath) {
  writeFileSync(config.envDumpPath, JSON.stringify(process.env), 'utf8');
}
if (config.argvDumpPath) {
  writeFileSync(
    config.argvDumpPath,
    JSON.stringify(process.argv.slice(2)),
    'utf8',
  );
}
if (config.cwdDumpPath) {
  writeFileSync(config.cwdDumpPath, process.cwd(), 'utf8');
}
if (config.stdoutFloodBytes) {
  await new Promise((resolve) => {
    process.stdout.write('X'.repeat(config.stdoutFloodBytes), resolve);
  });
}
const STDERR_LINE_WIDTH = 100;

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

async function writeStderrChunks() {
  // Newline-terminated lines rather than one giant unterminated blob: the
  // buffer only releases whole lines, so a single blob would leave the result
  // at the mercy of pipe chunking and let a bound assertion pass on no output
  // at all.
  const chunks = config.stderrBytes
    ? [
        ('A'.repeat(STDERR_LINE_WIDTH) + '\n').repeat(
          Math.ceil(config.stderrBytes / (STDERR_LINE_WIDTH + 1)),
        ),
      ]
    : (config.stderr ?? []);
  for (const chunk of chunks) {
    process.stderr.write(chunk);
    if (config.stderrDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, config.stderrDelayMs));
    }
  }
}

// `tools` may be a flat array (one page) or an array of pages.
const pages = Array.isArray(config.tools?.[0])
  ? config.tools
  : [config.tools ?? []];

function toolsListResult(cursor) {
  const index = cursor === undefined ? 0 : Number(cursor);
  const tools = pages[index] ?? [];
  const nextCursor = index + 1 < pages.length ? String(index + 1) : undefined;
  return nextCursor === undefined ? { tools } : { tools, nextCursor };
}

// One handler per JSON-RPC method, keyed by name — a lookup instead of an
// if/else chain, since the dispatch (below) is the same for every method.
const methodHandlers = {
  async initialize(message) {
    if (config.stderrPreInit) await writeStderrChunks();
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: config.protocolVersion ?? '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'stdio-fixture', version: '0.0.0' },
      },
    });
  },
  async 'notifications/initialized'(_message) {
    if (!config.stderrPreInit) await writeStderrChunks();
    if (config.exitAfterInit) process.exit(4);
  },
  'tools/list'(message) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: toolsListResult(message.params?.cursor),
    });
  },
  'tools/call'(message) {
    if (config.exitOnCall) process.exit(5);
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: config.callResult ?? {
        content: [{ type: 'text', text: 'ok' }],
      },
    });
  },
};

async function handleMessage(message) {
  const handler = methodHandlers[message.method];
  if (handler) {
    await handler(message);
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32_601, message: 'Method not found' },
    });
  }
}

let buffer = '';
process.stdin.on('data', async (data) => {
  buffer += data.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === '') continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    await handleMessage(message);
  }
});

process.stdin.on('end', () => process.exit(0));
