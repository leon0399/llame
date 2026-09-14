import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assignShardFiles,
  mergeMutationReports,
  mutationPlan,
  mutationRegressions,
  parseRunArguments,
  parseShard,
  resolveStrykerCli,
} from "./mutation-sharding.mjs";
import { resolveCommit } from "./mutation-scope.mjs";

const skippedPackages = [
  { package: "config-interpolation", mode: "skip" },
  { package: "runtime-safety", mode: "skip" },
];

test("the mutation plan assigns every API file to one weighted shard", () => {
  const files = ["src/heavy.ts", "src/light.ts", "src/middle.ts"];
  const weights = new Map([
    ["src/heavy.ts", 100],
    ["src/light.ts", 1],
    ["src/middle.ts", 50],
  ]);
  const plan = mutationPlan(
    {
      "apps/api": { mode: "scoped", files },
      "packages/config-interpolation": { mode: "skip", files: [] },
      "packages/runtime-safety": { mode: "skip", files: [] },
    },
    {
      "apps/api": {
        files: Object.fromEntries(
          [...weights].map(([file, mutants]) => [
            file,
            { mutants, undetected: 0, coveredBy: [] },
          ]),
        ),
      },
    },
  );
  assert.equal(plan.apiMode, "scoped");
  assert.deepEqual(
    plan.apiShards.flatMap(({ files: shardFiles }) => shardFiles).sort(),
    files,
  );
  // The heavy file must not share a shard with the other heavy file: the
  // assignment tracks measured work, not file count.
  const shardOf = (file) =>
    plan.apiShards.find(({ files: shardFiles }) => shardFiles.includes(file))
      .index;
  assert.notEqual(shardOf("src/heavy.ts"), shardOf("src/middle.ts"));
  for (const { index, shard } of plan.apiShards)
    assert.equal(index, Number(shard.split("/")[0]) - 1);
  assert.deepEqual(plan.packages, skippedPackages);
});

test("a small diff shares one runner instead of starting a runner per file", () => {
  const files = ["src/a.ts", "src/b.ts", "src/new.ts"];
  const scopes = {
    "apps/api": { mode: "scoped", files },
    "packages/config-interpolation": { mode: "skip", files: [] },
    "packages/runtime-safety": { mode: "skip", files: [] },
  };
  const baseline = {
    "apps/api": {
      files: {
        "src/a.ts": { mutants: 5 },
        "src/b.ts": { mutants: 5 },
        "src/unchanged.ts": { mutants: 790 },
      },
    },
  };
  const plan = mutationPlan(scopes, baseline);
  assert.deepEqual(plan.apiShards, [{ shard: "1/8", index: 0, files }]);
  const full = mutationPlan({
    ...scopes,
    "apps/api": {
      mode: "full",
      files: Array.from({ length: 16 }, (_, index) => `src/${index}.ts`),
    },
  });
  assert.equal(full.apiShards.length, 8);
});

test("an irrelevant change has no API shards but preserves package check names", () => {
  const plan = mutationPlan(
    Object.fromEntries(
      [
        "apps/api",
        "packages/config-interpolation",
        "packages/runtime-safety",
      ].map((workspace) => [workspace, { mode: "skip", files: [] }]),
    ),
  );
  assert.deepEqual(plan.apiShards, []);
  assert.equal(plan.packages.length, 2);
});

test("measured work is spread over the shard pool", () => {
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  const files = weights.map((_, index) => `src/file-${index}.ts`);
  const measured = new Map(files.map((file, index) => [file, weights[index]]));
  const loads = assignShardFiles(files, measured, 4).map((shard) =>
    shard.reduce((sum, file) => sum + measured.get(file), 0),
  );
  // Round-robin over the sorted paths would stack 8+4 and 7+3 on two shards.
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 2, loads.join(","));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  assert.equal(
    loads.reduce((sum, load) => sum + load, 0),
    total,
  );
});

test("equal or unknown weights still spread every file over the pool", () => {
  const files = Array.from(
    { length: 40 },
    (_, index) => `src/file-${index}.ts`,
  );
  for (const weights of [undefined, new Map(files.map((file) => [file, 5]))]) {
    const shards = assignShardFiles(files, weights, 8);
    assert.deepEqual(shards.flat().sort(), files.sort());
    assert.equal(new Set(shards.flat()).size, files.length);
    const counts = shards.map((shard) => shard.length);
    assert.equal(Math.max(...counts) - Math.min(...counts), 0);
  }
});

test("the shard runner takes its file list from the plan", () => {
  assert.deepEqual(
    parseRunArguments([
      "--shard",
      "3/8",
      "--mutate",
      "src/b.ts,src/a.ts",
      "--incremental",
    ]),
    {
      shard: { index: 2, number: 3, total: 8 },
      files: ["src/a.ts", "src/b.ts"],
      strykerArguments: ["--incremental"],
    },
  );
  assert.deepEqual(parseRunArguments(["--shard=4/8", "--mutate=src/a.ts"]), {
    shard: { index: 3, number: 4, total: 8 },
    files: ["src/a.ts"],
    strykerArguments: [],
  });
  // pnpm forwards its own separator, which Stryker must not receive.
  assert.deepEqual(
    parseRunArguments([
      "--",
      "--mutate",
      "src/a.ts",
      "--shard",
      "2/8",
      "--force",
    ]),
    {
      shard: { index: 1, number: 2, total: 8 },
      files: ["src/a.ts"],
      strykerArguments: ["--force"],
    },
  );
  assert.throws(() => parseRunArguments(["--shard", "3/8"]), /--mutate/u);
  assert.throws(() => parseRunArguments(["--mutate", "src/a.ts"]), /--shard/u);
  assert.throws(
    () =>
      parseRunArguments(["--shard", "1/8", "--mutate", "src/a.ts,,src/b.ts"]),
    /empty file name/u,
  );
  assert.throws(
    () =>
      parseRunArguments([
        "--shard",
        "1/8",
        "--mutate",
        "src/a.ts",
        "--mutate=src/b.ts",
      ]),
    /once/u,
  );
});

test("unfinished mutants cannot turn an incomplete run into a passing score", () => {
  for (const status of ["Pending", "NotRun", "Unknown", "toString"]) {
    assert.throws(
      () =>
        mergeMutationReports([
          {
            schemaVersion: "1.0",
            files: { "src/a.ts": { mutants: [{ status }] } },
          },
        ]),
      /Unfinished or unknown mutant status/u,
    );
  }
  assert.throws(
    () => mergeMutationReports([{ schemaVersion: "1.0" }]),
    /Invalid mutation report/u,
  );
});

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

test("resolveStrykerCli uses the workspace dependency", () => {
  assert.match(
    resolveStrykerCli(path.resolve("apps/api")),
    /@stryker-mutator[+/]core.*bin[\\/]stryker\.js/u,
  );
});

test("mutationRegressions reports only files that gained undetected mutants", () => {
  const baseline = {
    files: {
      "src/lost.ts": { mutants: 3, undetected: 0, coveredBy: [] },
      "src/improved.ts": { mutants: 3, undetected: 2, coveredBy: [] },
      "src/equal.ts": { mutants: 3, undetected: 1, coveredBy: [] },
    },
  };
  const current = {
    files: {
      "src/lost.ts": { mutants: 4, undetected: 2, coveredBy: [] },
      "src/improved.ts": { mutants: 3, undetected: 0, coveredBy: [] },
      "src/equal.ts": { mutants: 3, undetected: 1, coveredBy: [] },
      "src/new.ts": { mutants: 2, undetected: 1, coveredBy: [] },
    },
  };
  assert.deepEqual(mutationRegressions(baseline, current), [
    { file: "src/lost.ts", undetected: 2, previous: 0 },
    { file: "src/new.ts", undetected: 1, previous: 0 },
  ]);
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
    report("src/b.ts", [
      "NoCoverage",
      "CompileError",
      "RuntimeError",
      "Ignored",
    ]),
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

function runTool(...arguments_) {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./mutation-sharding.mjs", import.meta.url)),
      ...arguments_,
    ],
    { encoding: "utf8" },
  );
}

function reportFile(directory, name, files) {
  const file = path.join(directory, name);
  writeFileSync(file, JSON.stringify({ schemaVersion: "1.0", files }));
  return file;
}

test("aggregate accepts pnpm's argument separator", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-msi-"));
  try {
    const report = reportFile(directory, "mutation.json", {});
    const result = runTool("aggregate", "--", "--expected-shards", "1", report);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate rejects an MSI threshold outside 0 through 100", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-msi-"));
  try {
    const report = reportFile(directory, "mutation.json", {});
    for (const threshold of ["-1", "101"]) {
      const result = runTool("aggregate", "--threshold", threshold, report);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--threshold must be between 0 and 100/u);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate fails below the requested MSI threshold", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-msi-"));
  try {
    const report = reportFile(directory, "mutation.json", {
      "src/a.ts": { mutants: [{ id: "0", status: "Survived" }] },
    });
    const result = runTool("aggregate", "--threshold", "80", report);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Mutation score 0\.00% is below 80%/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate rejects a baseline combined with a threshold", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-delta-"));
  try {
    const report = reportFile(directory, "mutation.json", {});
    const result = runTool(
      "aggregate",
      "--threshold",
      "80",
      "--baseline",
      report,
      report,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not both/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("aggregate gates on undetected mutants gained against a baseline", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-delta-"));
  try {
    const index = path.join(directory, "baseline.json");
    writeFileSync(
      index,
      JSON.stringify({
        baselineVersion: 2,
        revision: resolveCommit("HEAD", process.cwd()),
        files: {
          "src/edited.ts": {
            mutants: 2,
            undetected: 1,
            coveredBy: ["src/edited.test.ts"],
          },
          "src/untouched.ts": { mutants: 1, undetected: 1, coveredBy: [] },
        },
      }),
    );
    const survivors = reportFile(directory, "mutation.json", {
      "src/edited.ts": {
        mutants: [
          { id: "0", status: "Killed" },
          { id: "1", status: "Survived" },
          { id: "2", status: "NoCoverage" },
        ],
      },
    });

    // One pre-existing survivor is forgiven; the second is this diff's doing.
    const failed = runTool("aggregate", "--baseline", index, survivors);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /src\/edited\.ts: 1 -> 2/u);
    assert.match(failed.stderr, /1 source files gained undetected mutants/u);

    const held = runTool(
      "aggregate",
      "--baseline",
      index,
      reportFile(directory, "resolved.json", {
        "src/edited.ts": {
          mutants: [
            { id: "0", status: "Killed" },
            { id: "1", status: "Survived" },
          ],
        },
      }),
    );
    assert.equal(held.status, 0, held.stderr);
    assert.match(held.stdout, /No new undetected mutants/u);

    // Anything that is not an index is refused: a raw report at this path means
    // the writer and the reader disagree about what a baseline is.
    const refusesRaw = runTool(
      "aggregate",
      "--baseline",
      survivors,
      reportFile(directory, "other.json", {}),
    );
    assert.equal(refusesRaw.status, 1);
    assert.match(refusesRaw.stderr, /Invalid mutation baseline/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("baseline folds reports into the index and keeps unmeasured files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-index-"));
  try {
    // The previous index is what a prior build wrote; the plan and the gate
    // read it back, so the round trip through disk is the contract.
    const previous = path.join(directory, "previous.json");
    writeFileSync(
      previous,
      JSON.stringify({
        baselineVersion: 2,
        revision: resolveCommit("HEAD", process.cwd()),
        files: {
          "src/kept.ts": {
            mutants: 1,
            undetected: 0,
            coveredBy: ["src/kept.test.ts"],
          },
          "src/refreshed.ts": { mutants: 1, undetected: 1, coveredBy: [] },
        },
      }),
    );
    const reports = [
      reportFile(directory, "shard-1.json", {
        "src/refreshed.ts": {
          mutants: [{ id: "0", status: "Killed" }],
        },
      }),
      reportFile(directory, "shard-2.json", {
        "src/added.ts": {
          mutants: [{ id: "0", status: "NoCoverage" }],
        },
      }),
    ];
    const output = path.join(directory, "nested", "mutation-baseline.json");
    const result = runTool(
      "baseline",
      "--previous",
      previous,
      "--output",
      output,
      ...reports,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      baselineVersion: 2,
      revision: resolveCommit("HEAD", process.cwd()),
      files: {
        "src/kept.ts": {
          mutants: 1,
          undetected: 0,
          coveredBy: ["src/kept.test.ts"],
        },
        "src/refreshed.ts": { mutants: 1, undetected: 0, coveredBy: [] },
        "src/added.ts": { mutants: 1, undetected: 1, coveredBy: [] },
      },
    });

    // A complete measurement removes old paths, including their allowances.
    const fresh = path.join(directory, "fresh.json");
    const rebuilt = runTool(
      "baseline",
      "--full",
      "--previous",
      previous,
      "--output",
      fresh,
      reports[1],
    );
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    assert.deepEqual(
      Object.keys(JSON.parse(readFileSync(fresh, "utf8")).files),
      ["src/added.ts"],
    );
    const recreated = runTool(
      "aggregate",
      "--baseline",
      fresh,
      reportFile(directory, "recreated.json", {
        "src/refreshed.ts": { mutants: [{ id: "0", status: "Survived" }] },
      }),
    );
    assert.equal(recreated.status, 1);
    assert.match(recreated.stdout, /src\/refreshed\.ts: 0 -> 1/u);

    const invalid = runTool(
      "baseline",
      "--previous",
      reports[0],
      "--output",
      output,
      reports[1],
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Invalid mutation baseline/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
