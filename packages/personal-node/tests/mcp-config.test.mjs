import test from "node:test";
import assert from "node:assert/strict";
import { parseMcpServers } from "../dist/mcp-config.js";

function parse(command) {
  return parseMcpServers(
    {
      local: {
        enabled: true,
        transport: "stdio",
        command,
      },
    },
    {},
    "/tmp/llame.config.json",
    [],
  );
}

test("stdio MCP commands must be nonempty and at most 2048 characters", () => {
  assert.throws(() => parse(""), { code: "invalid_data" });
  assert.throws(() => parse("x".repeat(2049)), { code: "invalid_data" });
  assert.equal(parse("node")[0].command, "node");
});
