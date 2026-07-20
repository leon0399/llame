import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.cwd();
const fixtureSource = path.join(packageRoot, "test/fixtures/project");
const fixtureCopy = path.join(packageRoot, "test/.tmp/project");

await rm(fixtureCopy, { recursive: true, force: true });
await mkdir(path.dirname(fixtureCopy), { recursive: true });
await cp(fixtureSource, fixtureCopy, { recursive: true });

const storybook = spawn(
  "pnpm",
  [
    "exec",
    "storybook",
    "dev",
    "--config-dir",
    path.join(fixtureCopy, ".storybook"),
    "--port",
    "6010",
    "--no-open",
  ],
  { cwd: packageRoot, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => storybook.kill(signal));
}

storybook.on("exit", (code) => process.exit(code ?? 1));
