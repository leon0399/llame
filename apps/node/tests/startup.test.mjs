import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
