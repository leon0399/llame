#!/usr/bin/env node
// Checks that `proto/protocol.json` records the fingerprint of the
// `stead.machine.v1` schema. The fingerprint is the sha256 of the `buf build`
// image without source info, so comments and formatting do not count.
// `--write` records the current fingerprint; CI runs `--check`, and with
// `--base <ref>` also refuses a schema change that kept the version.
/**
 * @typedef {{ fingerprint: string, version: number }} ProtocolRecord
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const recordFile = join(pkg, "proto", "protocol.json");

const protocolRecord = z.object({
  fingerprint: z.string(),
  version: z.number(),
});

function fingerprint() {
  const image = execFileSync(
    "pnpm",
    [
      "exec",
      "buf",
      "build",
      "--path",
      "proto/stead/machine/v1",
      "--exclude-source-info",
      "-o",
      "-#format=binpb",
    ],
    { cwd: pkg },
  );

  return createHash("sha256").update(image).digest("hex");
}

/** @param {string} text @returns {ProtocolRecord} */
function parseRecord(text) {
  return protocolRecord.parse(JSON.parse(text));
}

/** @param {string} ref @returns {ProtocolRecord | undefined} */
function baseRecord(ref) {
  execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: pkg,
    stdio: "ignore",
  });

  const path = "packages/machine-protocol/proto/protocol.json";

  const exists = execFileSync(
    "git",
    ["ls-tree", "--full-tree", "-r", "--name-only", ref, "--", path],
    { cwd: pkg, encoding: "utf8" },
  ).trim();

  if (!exists) return undefined;

  const text = execFileSync("git", ["show", `${ref}:${path}`], {
    cwd: pkg,
    encoding: "utf8",
  });

  return parseRecord(text);
}

const record = parseRecord(readFileSync(recordFile, "utf8"));
const current = fingerprint();

if (process.argv.includes("--write")) {
  writeFileSync(
    recordFile,
    `${JSON.stringify({ version: record.version, fingerprint: current }, null, 2)}\n`,
  );
  process.exit(0);
}

if (record.fingerprint !== current) {
  console.error(
    "The stead.machine.v1 schema changed. Increase `version` in proto/protocol.json, then run `pnpm --filter @workspace/machine-protocol proto:fingerprint`.",
  );
  process.exit(1);
}

const baseIndex = process.argv.indexOf("--base");

if (baseIndex !== -1) {
  const baseRef = process.argv[baseIndex + 1];

  if (baseRef === undefined) {
    throw new Error("Pass a Git ref after --base.");
  }

  const base = baseRecord(baseRef);

  if (
    base &&
    base.fingerprint !== record.fingerprint &&
    base.version >= record.version
  ) {
    console.error(
      "The schema changed but the protocol version did not increase.",
    );
    process.exit(1);
  }
}
