#!/usr/bin/env node
// Checks that `proto/protocol.json` records the fingerprint of the
// `stead.machine.v1` schema. The fingerprint is the sha256 of the `buf build`
// image without source info, so comments and formatting do not count.
// `--write` records the current fingerprint; CI runs `--check`, and with
// `--base <ref>` also refuses a schema change that kept the version.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const recordFile = join(pkg, "proto", "protocol.json");

function fingerprint() {
  const image = execFileSync(
    "pnpm",
    ["exec", "buf", "build", "--path", "proto/stead/machine/v1", "--exclude-source-info", "-o", "-#format=binpb"],
    { cwd: pkg },
  );

  return createHash("sha256").update(image).digest("hex");
}

function baseRecord(ref) {
  const text = execFileSync("git", ["show", `${ref}:packages/machine-protocol/proto/protocol.json`], {
    cwd: pkg,
    encoding: "utf8",
  });

  return JSON.parse(text);
}

const record = JSON.parse(readFileSync(recordFile, "utf8"));
const current = fingerprint();

if (process.argv.includes("--write")) {
  writeFileSync(recordFile, `${JSON.stringify({ ...record, fingerprint: current }, null, 2)}\n`);
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
  let base;

  try {
    base = baseRecord(process.argv[baseIndex + 1]);
  } catch {
    process.exit(0); // The base predates the record.
  }

  if (base.fingerprint !== record.fingerprint && base.version >= record.version) {
    console.error("The schema changed but the protocol version did not increase.");
    process.exit(1);
  }
}
