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
//   stderr           array    chunks written to stderr, in order
//   stderrBytes      number   generate one chunk of N bytes internally, so a
//                             large payload never travels through the env var
//   stderrPreInit    boolean  write those chunks before answering `initialize`
//   stderrDelayMs    number   delay between stderr chunks (to force chunk splits)
//   envDumpPath      string   write `process.env` here as JSON, then continue
//   argvDumpPath     string   write `process.argv.slice(2)` here as JSON
//   cwdDumpPath      string   write `process.cwd()` here
//   exitAfterInit    boolean  exit non-zero once initialized

import { writeFileSync } from 'node:fs';

const config = JSON.parse(process.env.MCP_FIXTURE ?? '{}');

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
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

async function writeStderrChunks() {
  const chunks = config.stderrBytes
    ? ['A'.repeat(config.stderrBytes) + '\n']
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

    if (message.method === 'initialize') {
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
      continue;
    }

    if (message.method === 'notifications/initialized') {
      if (!config.stderrPreInit) await writeStderrChunks();
      if (config.exitAfterInit) process.exit(4);
      continue;
    }

    if (message.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: toolsListResult(message.params?.cursor),
      });
      continue;
    }

    if (message.method === 'tools/call') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: config.callResult ?? {
          content: [{ type: 'text', text: 'ok' }],
        },
      });
      continue;
    }

    if (message.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }
  }
});

process.stdin.on('end', () => process.exit(0));
