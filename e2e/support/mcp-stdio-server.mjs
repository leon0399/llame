// Deterministic local MCP server for the stdio browser acceptance case.
//
// Plain `.mjs` because llame spawns it with a bare `node`. It speaks
// newline-framed JSON-RPC over stdin/stdout, exposes one read-only tool, and
// writes a line to stderr on startup so the run also exercises the captured,
// sanitized diagnostic path.
//
// If `E2E_STDIO_MCP_SECRET` is set (llame resolves it from an interpolated
// entry), the server echoes it to stderr and into its tool result — both must
// come back redacted, never verbatim.

const SENTINEL = "FIXTURE_STDIO_SENTINEL";
const secret = process.env.E2E_STDIO_MCP_SECRET ?? "";

process.stderr.write(
  secret.length > 0
    ? `stdio fixture ready, token=${secret}\n`
    : "stdio fixture ready\n",
);

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === "") continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "e2e-stdio-fixture", version: "0.0.0" },
        },
      });
    } else if (message.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "lookup",
              description: "Looks up deterministic local fixture evidence.",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
              },
            },
          ],
        },
      });
    } else if (message.method === "tools/call") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text:
                secret.length > 0 ? `${SENTINEL} (token ${secret})` : SENTINEL,
            },
          ],
        },
      });
    } else if (message.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32_601, message: "Method not found" },
      });
    }
  }
});

process.stdin.on("end", () => process.exit(0));
