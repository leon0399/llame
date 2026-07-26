import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = await mkdtemp(
  path.join(tmpdir(), "storybook-addon-build-"),
);
const distDirectory = path.join(fixtureRoot, "dist");
const staleOutput = path.join(distDirectory, ".stale-build-output");

try {
  await cp(path.join(packageRoot, "src"), path.join(fixtureRoot, "src"), {
    recursive: true,
  });
  await mkdir(path.join(fixtureRoot, "scripts"));
  await Promise.all([
    copyFile(
      path.join(packageRoot, "scripts", "build.mjs"),
      path.join(fixtureRoot, "scripts", "build.mjs"),
    ),
    copyFile(
      path.join(packageRoot, "package.json"),
      path.join(fixtureRoot, "package.json"),
    ),
    copyFile(
      path.join(packageRoot, "tsconfig.json"),
      path.join(fixtureRoot, "tsconfig.json"),
    ),
    copyFile(
      path.join(packageRoot, "tsconfig.build.json"),
      path.join(fixtureRoot, "tsconfig.build.json"),
    ),
    symlink(
      path.join(packageRoot, "node_modules"),
      path.join(fixtureRoot, "node_modules"),
      "dir",
    ),
  ]);

  await mkdir(distDirectory);
  await writeFile(staleOutput, "must be removed by build", { flag: "wx" });

  const built = spawnSync(process.execPath, ["./scripts/build.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (built.error) {
    throw new Error(`Unable to start package build: ${built.error.message}`);
  }
  if (built.status !== 0) {
    throw new Error(
      `Package build failed:\n${built.stderr || built.stdout}`.trim(),
    );
  }

  await assert.rejects(
    stat(staleOutput),
    (error) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
    "build must remove stale dist output before compiling",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
