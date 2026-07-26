import { rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDirectory = path.join(packageRoot, "dist");

if (
  path.dirname(distDirectory) !== packageRoot ||
  path.basename(distDirectory) !== "dist"
) {
  throw new Error("Refusing to clean an invalid build output path.");
}

await rm(distDirectory, { recursive: true, force: true });

const compiled = spawnSync("tsc", ["-p", "tsconfig.build.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});
if (compiled.error) {
  throw new Error(
    `Unable to start TypeScript compiler: ${compiled.error.message}`,
  );
}
if (compiled.status !== 0) {
  process.exitCode = compiled.status ?? 1;
}
