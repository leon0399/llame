// A minimal MCP server speaking newline-framed JSON-RPC over stdin/stdout,
// started by the daemon's own `mcp.open` exactly as a Workspace's `.mcp.json`
// declares it.
//
// Plain `.mjs` on purpose: the daemon spawns `command`+`args` as a real
// process, so vitest's transform never applies and this file is outside the
// TypeScript program -- `apps/machine/.oxlintrc.json` says so, exactly as the
// hub's own stdio fixture does for the type-aware rules that assume one.
//
// Behavior is driven by the `MACHINE_MCP_FIXTURE` environment variable holding
// a JSON object, which is also how a test proves which definition's resolved
// environment actually reached the child:
//
//   protocolVersion  string   version reported from `initialize`
//   tools            array    tool declarations for `tools/list`
//   pidFile          string   write `process.pid` here
//   envDumpPath      string   write `process.env` here as JSON
//   stderr           array    chunks written to stderr after initialized
//   exitAfterInit    boolean  exit non-zero once initialized

import { writeFileSync } from "node:fs";

const config = JSON.parse(process.env.MACHINE_MCP_FIXTURE ?? "{}");

if (config.pidFile) writeFileSync(config.pidFile, String(process.pid));
if (config.envDumpPath)
  writeFileSync(config.envDumpPath, JSON.stringify(process.env));

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handlers = {
  initialize(message) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: config.protocolVersion ?? "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "machine-stdio-fixture", version: "0.0.0" },
      },
    });
  },
  "notifications/initialized"() {
    for (const chunk of config.stderr ?? []) process.stderr.write(chunk);
    if (config.exitAfterInit) process.exit(4);
  },
  "tools/list"(message) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: config.tools ?? [] },
    });
  },
};

function handleMessage(message) {
  const handler = handlers[message.method];
  if (handler) {
    handler(message);
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32_601, message: "Method not found" },
    });
  }
}

let buffer = "";
process.stdin.on("data", (data) => {
  buffer += data.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() !== "") {
      handleMessage(JSON.parse(line));
    }
    newline = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
