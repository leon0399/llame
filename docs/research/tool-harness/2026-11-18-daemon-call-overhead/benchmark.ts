import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createRootGuard } from "../../../../apps/machine/src/guard";
import { readOperation } from "../../../../apps/machine/src/files";
import { grepOperation } from "../../../../apps/machine/src/grep";

const root = resolve(import.meta.dirname, "../../../..");
const files = [
  "README.md",
  "apps/api/src/tools/native-files.ts",
  "packages/machine-protocol/src/types.ts",
];
async function main() {
  const daemonPath = join(root, "apps/machine/dist/llame-machine.cjs");
  const configDir = await mkdtemp(join(tmpdir(), "llame-bench-config-"));
  const env = { ...process.env, LLAME_MACHINE_CONFIG_DIR: configDir };
  const setup = spawn("node", [daemonPath, "roots", "add", root], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const setupResult = await new Promise<{
    code: number | null;
    output: string;
  }>((resolvePromise) => {
    let output = "";
    setup.stdout.on("data", (chunk) => {
      output += chunk;
    });
    setup.stderr.on("data", (chunk) => {
      output += chunk;
    });
    setup.once("exit", (code) => resolvePromise({ code, output }));
  });
  if (setupResult.code !== 0)
    throw new Error(
      `register root failed (${setupResult.code}): ${setupResult.output}`,
    );
  const child = spawn("node", [daemonPath, "serve", "--stdio"], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let nextId = 1;
  let nextStream = 1;
  const pending = new Map<number, (value: unknown) => void>();
  lines.on("line", (line) => {
    const frame = JSON.parse(line) as {
      s: number;
      m: { id?: number; result?: unknown; error?: unknown };
    };
    if (frame.m.id !== undefined)
      pending.get(frame.m.id)?.(frame.m.error ?? frame.m.result);
    if (frame.m.id !== undefined) pending.delete(frame.m.id);
  });
  function request(
    method: string,
    params: unknown,
    stream?: number,
  ): Promise<unknown> {
    const id = nextId++;
    const streamId = stream === 0 ? 0 : nextStream++;
    return new Promise((resolvePromise) => {
      pending.set(id, resolvePromise);
      child.stdin.write(
        `${JSON.stringify({ s: streamId, m: { jsonrpc: "2.0", id, method, params } })}\n`,
      );
    });
  }
  const handshakeStart = performance.now();
  await request("hello", { protocolVersion: 1, hubVersion: "benchmark" }, 0);
  const handshakeMs = performance.now() - handshakeStart;
  const abort = new AbortController();
  const context = {
    roots: [root],
    guard: createRootGuard([root]),
    processes: {} as never,
    signal: abort.signal,
    streamSignal: abort.signal,
    toolCallId: undefined,
    notify() {},
    onNotification() {},
    closeStream() {},
  };
  const envelope = { budgetMs: 30_000 };
  const readParams = (path: string, options: Record<string, unknown> = {}) => ({
    envelope,
    path,
    options: { displayPrefix: "machine://bench/", ...options },
  });
  const grepParams = {
    envelope,
    path: root,
    patterns: ["export async function", "TODO"],
    literal: false,
    ignoreCase: false,
    bounds: {
      files: 100,
      entries: 100,
      bytes: 500_000,
      fileBytes: 100_000,
      deadlineMs: 30_000,
      limit: 50,
      pageUnits: 50,
      progressed: false,
    },
  };
  const cases: Array<{
    name: string;
    method: string;
    params: unknown;
    local: () => Promise<unknown>;
  }> = [];
  for (const file of files) {
    const path = join(root, file);
    cases.push({
      name: `read:${file}`,
      method: "fs.read",
      params: readParams(path),
      local: () => readOperation(readParams(path) as never, context),
    });
    cases.push({
      name: `read-range:${file}`,
      method: "fs.read",
      params: readParams(path, { ranges: [{ startLine: 1, endLine: 40 }] }),
      local: () =>
        readOperation(
          readParams(path, {
            ranges: [{ startLine: 1, endLine: 40 }],
          }) as never,
          context,
        ),
    });
  }
  // Include one ~100 KiB source file via a temporary registered corpus file.
  await writeFile(
    join(root, ".daemon-overhead-100k.tmp"),
    "line\n".repeat(20_480),
  );
  cases.push({
    name: "read:100KiB",
    method: "fs.read",
    params: readParams(join(root, ".daemon-overhead-100k.tmp")),
    local: () =>
      readOperation(
        readParams(join(root, ".daemon-overhead-100k.tmp")) as never,
        context,
      ),
  });
  cases.push({
    name: "grep:apps-packages",
    method: "fs.grep",
    params: grepParams,
    local: () => grepOperation(grepParams as never, context),
  });
  async function measure(
    fn: () => Promise<unknown>,
    iterations = 40,
    concurrency = 1,
  ) {
    for (let i = 0; i < 5; i++) await fn();
    const samples: number[] = [];
    const start = performance.now();
    for (let i = 0; i < iterations; i += concurrency) {
      const batch = Array.from(
        { length: Math.min(concurrency, iterations - i) },
        async () => {
          const then = performance.now();
          await fn();
          return performance.now() - then;
        },
      );
      samples.push(...(await Promise.all(batch)));
    }
    samples.sort((a, b) => a - b);
    return {
      calls: iterations,
      concurrency,
      p50Ms: samples[Math.floor(samples.length * 0.5)],
      p95Ms:
        samples[
          Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)
        ],
      callsPerSecond: iterations / ((performance.now() - start) / 1000),
    };
  }
  const results = [];
  for (const item of cases) {
    for (const concurrency of [1, 8]) {
      const local = await measure(item.local, 40, concurrency);
      const remote = await measure(
        () => request(item.method, item.params),
        40,
        concurrency,
      );
      results.push({ name: item.name, local, daemon: remote });
    }
  }
  const rssKb = (pid: number) =>
    Number(
      (readFileSync(`/proc/${pid}/status`, "utf8").match(
        /^VmRSS:\s+(\d+)/m,
      ) ?? [0, 0])[1],
    );
  console.log(
    JSON.stringify(
      {
        handshakeMs,
        daemonPid: child.pid,
        daemonRssKb: child.pid ? rssKb(child.pid) : null,
        driverRssKb: rssKb(process.pid),
        results,
      },
      null,
      2,
    ),
  );
  child.kill("SIGTERM");
  await rm(join(root, ".daemon-overhead-100k.tmp"), { force: true });
  await rm(configDir, { recursive: true, force: true });
}
void main();
