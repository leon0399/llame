import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertArchiveTargetAbsent,
  validateArchiveOutputPath,
} from "./archive-paths.mjs";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argumentsAfterSeparator = process.argv.slice(2);
if (argumentsAfterSeparator[0] === "--") argumentsAfterSeparator.shift();
const [outputPath] = argumentsAfterSeparator;

if (argumentsAfterSeparator.length !== 1 || outputPath === undefined) {
  throw new Error(
    "Usage: pnpm pack:artifact -- <absolute-path-ending-in-.tgz>",
  );
}
validateArchiveOutputPath(outputPath, packageRoot);
await assertArchiveTargetAbsent(outputPath);

const outputDirectory = path.dirname(outputPath);
await mkdir(outputDirectory, { recursive: true });
if ((await realpath(outputDirectory)) !== outputDirectory) {
  throw new Error(
    "Archive output directory must not contain symbolic-link aliases.",
  );
}

const temporaryDirectory = await mkdtemp(
  path.join("/tmp", "storybook-addon-pack-"),
);

try {
  const packed = spawnSync(
    "pnpm",
    ["pack", "--pack-destination", temporaryDirectory],
    {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (packed.error) {
    throw new Error(`Unable to start pnpm pack: ${packed.error.message}`);
  }
  if (packed.status !== 0) {
    throw new Error(
      `pnpm pack failed:\n${packed.stderr || packed.stdout}`.trim(),
    );
  }

  const archives = (await readdir(temporaryDirectory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(
      `pnpm pack produced ${String(archives.length)} archives; expected exactly one.`,
    );
  }

  await copyFile(
    path.join(temporaryDirectory, archives[0]),
    outputPath,
    constants.COPYFILE_EXCL,
  );
  console.log(outputPath);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
