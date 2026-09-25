/**
 * Regression for concurrent HOLD waiters on the e2e model server.
 * Restoring a single shared `wake` leaves one response hanging while this
 * test stays green only if both bodies complete after one release.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const modelServer = path.join(root, "e2e/support/model-server.ts");

async function waitReady(port, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(50);
  }
  throw new Error(`model server on :${port} never became ready`);
}

async function withModelServer(run) {
  const port = 14_000 + Math.floor(Math.random() * 2_000);
  const child = spawn(process.execPath, ["--import", "tsx", modelServer], {
    cwd: root,
    env: { ...process.env, E2E_MODEL_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitReady(port);
    await run(port);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    if (stderr && child.exitCode && child.exitCode !== 0) {
      assert.fail(`model server stderr:\n${stderr}`);
    }
  }
}

test("release wakes every concurrent HOLD waiter", async () => {
  await withModelServer(async (port) => {
    const token = "multi-waiter";
    const heldBody = JSON.stringify({
      messages: [{ role: "user", content: `HOLD:${token} please` }],
    });
    const postHeld = () =>
      fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: heldBody,
      });

    const first = postHeld();
    const second = postHeld();

    await assert.doesNotReject(async () => {
      for (let i = 0; i < 40; i++) {
        const status = await fetch(`http://127.0.0.1:${port}/hold/${token}`);
        const body = await status.json();
        if (body.arrived === true) return;
        await delay(50);
      }
      throw new Error("hold never arrived");
    });

    const release = await fetch(
      `http://127.0.0.1:${port}/hold/${token}/release`,
      { method: "POST" },
    );
    assert.equal(release.status, 200);

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const textA = await a.text();
    const textB = await b.text();
    for (const text of [textA, textB]) {
      assert.match(text, /Mocked/);
      assert.match(text, /data: \[DONE\]/);
    }
  });
});
