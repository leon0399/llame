import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  mergeMutationReports,
  parseRunArguments,
  parseShard,
  resolveStrykerCli,
  selectShardFiles,
} from "./mutation-sharding.mjs";

test("parseShard accepts one-based shard notation", () => {
  assert.deepEqual(parseShard("3/8"), { index: 2, number: 3, total: 8 });
});

test("parseShard rejects invalid shard notation", () => {
  for (const value of [
    "0/8",
    "9/8",
    "1/0",
    "1",
    "one/eight",
    "9007199254740992/9007199254740992",
    `${"9".repeat(400)}/${"9".repeat(400)}`,
  ]) {
    assert.throws(() => parseShard(value), /shard/u);
  }
});

test("parseRunArguments removes the shard option and forwards Stryker options", () => {
  assert.deepEqual(
    parseRunArguments(["--", "--incremental", "--shard", "2/8", "--force"]),
    {
      shard: { index: 1, number: 2, total: 8 },
      strykerArguments: ["--incremental", "--force"],
    },
  );
  assert.deepEqual(parseRunArguments(["--shard=4/8"]), {
    shard: { index: 3, number: 4, total: 8 },
    strykerArguments: [],
  });
});

test("parseRunArguments requires exactly one shard", () => {
  assert.throws(() => parseRunArguments([]), /--shard/u);
  assert.throws(
    () => parseRunArguments(["--shard", "1/8", "--shard=2/8"]),
    /once/u,
  );
});

test("resolveStrykerCli uses the workspace dependency", () => {
  assert.match(
    resolveStrykerCli(path.resolve("apps/api")),
    /@stryker-mutator[+/]core.*bin[\\/]stryker\.js/u,
  );
});

test("selectShardFiles partitions every file exactly once", () => {
  const files = Array.from(
    { length: 40 },
    (_, index) => `src/file-${index}.ts`,
  );
  const shards = Array.from({ length: 8 }, (_, index) =>
    selectShardFiles(files, { index, total: 8 }),
  );

  assert.deepEqual(shards.flat().sort(), files.sort());
  assert.equal(new Set(shards.flat()).size, files.length);
  assert.ok(shards.every((shard) => shard.length > 0));
});

test("selectShardFiles keeps existing assignments when another file is added", () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const before = files.map((file) =>
    Array.from({ length: 8 }, (_, index) =>
      selectShardFiles(files, { index, total: 8 }).includes(file),
    ).findIndex(Boolean),
  );
  const after = files.map((file) =>
    Array.from({ length: 8 }, (_, index) =>
      selectShardFiles([...files, "src/new.ts"], { index, total: 8 }).includes(
        file,
      ),
    ).findIndex(Boolean),
  );

  assert.deepEqual(after, before);
});

test("mergeMutationReports uses Stryker's mutation score semantics", () => {
  const report = (file, statuses) => ({
    schemaVersion: "1.0",
    files: {
      [file]: {
        language: "typescript",
        source: "export const value = 1;",
        mutants: statuses.map((status, id) => ({ id: String(id), status })),
      },
    },
  });

  const result = mergeMutationReports([
    report("src/a.ts", ["Killed", "Timeout", "Survived"]),
    report("src/b.ts", ["NoCoverage", "CompileError", "RuntimeError"]),
  ]);

  assert.deepEqual(result.counts, {
    killed: 1,
    timeout: 1,
    survived: 1,
    noCoverage: 1,
    compileError: 1,
    runtimeError: 1,
  });
  assert.equal(result.score, 50);
  assert.deepEqual(Object.keys(result.report.files), ["src/a.ts", "src/b.ts"]);
});

test("mergeMutationReports rejects duplicate source files", () => {
  const report = {
    schemaVersion: "1.0",
    files: { "src/a.ts": { mutants: [] } },
  };

  assert.throws(
    () => mergeMutationReports([report, report]),
    /Duplicate mutation report file: src\/a\.ts/u,
  );
});

test("aggregate accepts pnpm's argument separator", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-shard-"));
  const reportFile = path.join(directory, "mutation.json");
  writeFileSync(
    reportFile,
    JSON.stringify({ schemaVersion: "1.0", files: {} }),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./mutation-sharding.mjs", import.meta.url)),
        "aggregate",
        "--",
        "--expected-shards",
        "1",
        reportFile,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate rejects an MSI threshold outside 0 through 100", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-msi-"));
  const reportFile = path.join(directory, "mutation.json");
  writeFileSync(
    reportFile,
    JSON.stringify({ schemaVersion: "1.0", files: {} }),
  );

  try {
    for (const threshold of ["-1", "101"]) {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./mutation-sharding.mjs", import.meta.url)),
          "aggregate",
          "--threshold",
          threshold,
          reportFile,
        ],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /--threshold must be between 0 and 100/u);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate fails below the requested MSI threshold", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-msi-"));
  const reportFile = path.join(directory, "mutation.json");
  writeFileSync(
    reportFile,
    JSON.stringify({
      schemaVersion: "1.0",
      files: {
        "src/a.ts": { mutants: [{ id: "0", status: "Survived" }] },
      },
    }),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./mutation-sharding.mjs", import.meta.url)),
        "aggregate",
        "--threshold",
        "80",
        reportFile,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Mutation score 0\.00% is below 80%/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
