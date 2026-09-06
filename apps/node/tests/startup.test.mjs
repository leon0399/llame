import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const bin = fileURLToPath(new URL("../bin/llame-node.cjs", import.meta.url));

function writeFrame(child, id, method, params) {
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
  );
}

function collectFrames(out) {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
}

function startNode(data) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        bin,
        "--stdio",
        "--data-dir",
        data,
        "--config",
        join(data, "absent.json"),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Node startup timeout"));
    }, 5000);
    let out = "";
    let err = "";
    child.stdout.on("data", (bytes) => {
      out += bytes;
      if (collectFrames(out).some((frame) => frame.id === "describe"))
        child.stdin.end();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(Error(err));
      else resolve(out.trim().split("\n").map(JSON.parse));
    });
    writeFrame(child, "hello", "core.hello", { version: 2 });
    let sent = false;
    child.stdout.on("data", () => {
      if (sent || !out.includes('"id":"hello"')) return;
      sent = true;
      writeFrame(child, "describe", "core.describe", {});
    });
  });
}

function failNode(data, stdio = false) {
  const options = [
    ...(stdio ? ["--stdio"] : []),
    "--data-dir",
    data,
    "--config",
    join(data, "absent.json"),
  ];
  return runNode(options);
}

function runNode(args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function exitedPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    child.on("error", reject);
    child.on("close", () => resolve(child.pid));
  });
}

test("personal Node starts directly without the CLI, negotiates owner access, and persists its identity", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "node-app-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const first = (await startNode(data)).find(
    (frame) => frame.id === "describe",
  ).result;
  const second = (await startNode(data)).find(
    (frame) => frame.id === "describe",
  ).result;
  assert.equal(first.kind, "personal-node");
  assert.equal(first.nodeId, second.nodeId);
  assert.equal(first.principal.id, first.nodeId);
  assert.equal(first.synchronization, false);
  assert.ok(first.methods.includes("realm.knowledge.read"));
});

test("Unix startup failures stay off stdout", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "node-app-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  writeFileSync(join(data, "node.sock"), "occupied");

  const result = await failNode(data);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /node_socket_exists/);
});

test("stdio startup failures remain JSON-RPC frames", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "node-app-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const file = join(data, "not-a-directory");
  writeFileSync(file, "occupied");

  const result = failNode(file, true);

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    jsonrpc: "2.0",
    method: "core.error",
    params: {
      code: "node_start_failed",
      message: "Local Node could not start. No action was retried.",
    },
  });
});

test("standalone recover removes a proven-dead ownership record", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "node-app-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const pid = await exitedPid();
  const ownership = join(data, "node-server.json");
  writeFileSync(ownership, JSON.stringify({ pid, nonce: "stale" }), {
    mode: 0o600,
  });

  const result = runNode(["recover", "--data-dir", data]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /recovered/);
  assert.equal(existsSync(ownership), false);
});

test("standalone recover refuses a live ownership record", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "node-app-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const ownership = join(data, "node-server.json");
  const original = JSON.stringify({ pid: process.pid, nonce: "live" });
  writeFileSync(ownership, original, { mode: 0o600 });

  const result = runNode(["recover", "--data-dir", data]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /node_busy/);
  assert.equal(readFileSync(ownership, "utf8"), original);
});
