import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [url, command, ...args] = process.argv.slice(2);

if (!url || !command) {
  console.error("Usage: run-after-ready <url> <command> [...args]");
  process.exit(1);
}

async function waitForUrl(): Promise<void> {
  const timeout = Date.now() + 120_000;

  while (Date.now() < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main(): Promise<void> {
  await waitForUrl();

  const executable =
    process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const child = spawn(executable, args, {
    env: process.env,
    stdio: "inherit",
  });

  function forward(signal: NodeJS.Signals): void {
    child.kill(signal);
  }

  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);

  await new Promise<void>((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
