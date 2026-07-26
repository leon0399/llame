import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  findDisallowedTarballEntries,
  findMissingRequiredEntries,
  MAX_PACKED_ARCHIVE_SIZE_BYTES,
} from "./pack-inventory.mjs";

const argumentsAfterSeparator = process.argv.slice(2);
if (argumentsAfterSeparator[0] === "--") argumentsAfterSeparator.shift();
const [archiveArgument] = argumentsAfterSeparator;
if (argumentsAfterSeparator.length !== 1 || archiveArgument === undefined) {
  throw new Error("Usage: pnpm test:pack -- <absolute-path-ending-in-.tgz>");
}
if (
  !path.isAbsolute(archiveArgument) ||
  path.normalize(archiveArgument) !== archiveArgument ||
  !archiveArgument.endsWith(".tgz")
) {
  throw new Error("Package archive path must be an absolute normalized .tgz.");
}

// Read-only inspection: never rebuild or repack the archive.
const archivePath = await realpath(archiveArgument);
assert.equal(
  (await stat(archivePath)).isFile(),
  true,
  "archive must be a file",
);

const listed = spawnSync("tar", ["-tzf", archivePath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (listed.error) {
  throw new Error(`Unable to start tar: ${listed.error.message}`);
}
if (listed.status !== 0) {
  throw new Error(
    `Listing archive entries failed:\n${listed.stderr || listed.stdout}`.trim(),
  );
}

const entryNames = listed.stdout
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => (line.endsWith("/") ? line.slice(0, -1) : line));

const violations = [];

const disallowedEntries = findDisallowedTarballEntries(entryNames);
if (disallowedEntries.length > 0) {
  violations.push(
    [
      "unallowlisted entries (only package/dist/**, package/LICENSE, " +
        "package/README.md, and package/package.json are permitted):",
      ...disallowedEntries.map((entryName) => `  - ${entryName}`),
    ].join("\n"),
  );
}

const missingEntries = findMissingRequiredEntries(entryNames);
if (missingEntries.length > 0) {
  violations.push(
    [
      "missing required entries:",
      ...missingEntries.map((entryName) => `  - ${entryName}`),
    ].join("\n"),
  );
}

const archiveSizeBytes = (await stat(archivePath)).size;
if (archiveSizeBytes > MAX_PACKED_ARCHIVE_SIZE_BYTES) {
  violations.push(
    `archive is ${String(archiveSizeBytes)} bytes, exceeding the ` +
      `${String(MAX_PACKED_ARCHIVE_SIZE_BYTES)}-byte packed-size budget`,
  );
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n\n")}\n`);
  process.exitCode = 1;
} else {
  console.log(
    `${archivePath}: ${String(entryNames.length)} entries, ` +
      `${String(archiveSizeBytes)} bytes ` +
      `(within ${String(MAX_PACKED_ARCHIVE_SIZE_BYTES)}-byte budget)`,
  );
}
