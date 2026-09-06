import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceFiles, digest } from "../dist/workspace-files.js";
import { removeDeadLock } from "../dist/execution-lock.js";
import { McpHost } from "../dist/mcp-host.js";

function workspace() {
  return mkdtempSync(join(tmpdir(), "llame-node-workspace-security-"));
}

function server(overrides = {}) {
  return {
    id: "demo",
    transport: "http",
    url: "https://example.test/mcp",
    headers: {},
    autoApprove: [],
    callTimeoutSeconds: 0.01,
    ...overrides,
  };
}

function connection(tool) {
  return {
    async discover() {
      return { tools: [tool], refused: [] };
    },
    async close() {},
  };
}

test("WorkspaceFiles blocks common credential file names", () => {
  const root = workspace();
  mkdirSync(join(root, "keys"));
  writeFileSync(join(root, ".envrc"), "export TOKEN=secret");
  writeFileSync(join(root, "keys", "server-key.pem"), "private key");
  const files = new WorkspaceFiles(root, []);

  for (const path of [".envrc", "keys/server-key.pem"]) {
    assert.throws(() => files.read(path), { code: "path_denied" });
  }
});

test("MCP call timeout starts after terminal approval", async () => {
  let executed = false;
  const tool = {
    id: "mcp__demo__lookup",
    remoteName: "lookup",
    description: "Lookup",
    inputSchema: { type: "object" },
    validate: () => true,
    async execute(_args, _callId, signal) {
      executed = true;
      assert.equal(signal.aborted, false);
      return {
        result: { status: "success", value: "ok" },
        disconnected: false,
      };
    },
  };
  const host = await McpHost.connect(
    [server()],
    [],
    {},
    new AbortController().signal,
    async () => connection(tool),
  );
  try {
    const result = await host.execute(
      "mcp__demo__lookup",
      { query: "safe" },
      "call-1",
      new AbortController().signal,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return true;
      },
      () => {},
    );
    assert.deepEqual(result, { status: "success", value: "ok" });
    assert.equal(executed, true);
  } finally {
    await host.close();
  }
});

test("removeDeadLock reclaims a stale recovery guard", () => {
  const directory = workspace();
  const staleOwner = JSON.stringify({ pid: 2_147_483_647, nonce: "stale" });
  writeFileSync(join(directory, "recovery.lock"), staleOwner, { mode: 0o600 });
  writeFileSync(join(directory, "executor.lock"), staleOwner, { mode: 0o600 });

  removeDeadLock(directory);

  assert.equal(existsSync(join(directory, "recovery.lock")), false);
  assert.equal(existsSync(join(directory, "executor.lock")), false);
});

test("WorkspaceFiles rejects a concurrent replacement instead of overwriting it", async () => {
  const root = workspace();
  const target = join(root, "note.txt");
  const original = "original\n";
  writeFileSync(target, original, { mode: 0o600 });
  const expected = digest(original);
  const script = fileURLToPath(
    new URL("./workspace-writer.mjs", import.meta.url),
  );

  const firstResultPath = join(root, "first.result");
  const first = spawn(
    process.execPath,
    [script, root, expected, "first", firstResultPath],
    { stdio: "ignore" },
  );
  const firstResultPromise = collect(first, firstResultPath);
  await waitForPath(join(root, "before-replace"));
  const secondResultPath = join(root, "second.result");
  const second = spawn(
    process.execPath,
    [script, root, expected, "second", secondResultPath],
    { stdio: "ignore" },
  );
  const secondResultPromise = collect(second, secondResultPath);
  const [firstResult, secondResult] = await Promise.all([
    firstResultPromise,
    secondResultPromise,
  ]);
  const results = [firstResult, secondResult];
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(
    results.filter((result) => result.code === "stale_file").length,
    1,
  );
  assert.equal(readFileSync(target, "utf8"), "first\n");
});

function waitForPath(path) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const check = () => {
      if (existsSync(path)) resolve();
      else if (Date.now() >= deadline)
        reject(new Error(`Child did not create ${path}.`));
      else setTimeout(check, 5);
    };
    check();
  });
}

function collect(child, resultPath) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => {
      try {
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        resolve({ ...result, status });
      } catch (error) {
        reject(error);
      }
    });
  });
}
