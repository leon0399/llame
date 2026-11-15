import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  changedLineRanges,
  mergeMutationReports,
  mutateRanges,
  mutationArguments,
  mutationSourceFiles,
  shardEntries,
  writeScopeConfig,
} from "./mutation-changed-lines.mjs";

const workspace = "packages/runtime-safety";

// A Git hook exports GIT_INDEX_FILE, GIT_DIR and friends. Inheriting them
// makes every command below operate on the *caller's* repository whatever
// `cwd` says, so a temp-repository `git add` stages temp files into the real
// commit and writes their blobs somewhere the real object store cannot see.
for (const variable of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .trim()
  .split("\n"))
  delete process.env[variable];

function git(directory, ...arguments_) {
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...arguments_], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * A repository shaped like this one: three mutation workspaces, each with the
 * Stryker configuration that decides which of its files carry mutants.
 */
function repository(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "changed-lines-"));
  git(directory, "init", "--initial-branch=master");
  git(directory, "config", "user.name", "Changed lines test");
  git(directory, "config", "user.email", "changed-lines@example.invalid");
  for (const each of ["apps/api", "packages/config-interpolation", workspace]) {
    mkdirSync(path.join(directory, each, "src"), { recursive: true });
    // Every workspace needs at least one mutant source: an empty configured
    // scope is a configuration error, not an inert workspace.
    writeFileSync(
      path.join(directory, each, "src/index.ts"),
      "export const value = 1;\n",
    );
    writeFileSync(
      path.join(directory, each, "stryker.config.json"),
      JSON.stringify({
        mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
        testRunner: "vitest",
      }),
    );
  }
  for (const [file, content] of Object.entries(files))
    write(directory, file, content);
  git(directory, "add", "-A");
  git(directory, "commit", "-m", "base");
  return directory;
}

function write(directory, file, content) {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), content);
}

function commit(directory, files) {
  for (const [file, content] of Object.entries(files))
    write(directory, file, content);
  git(directory, "add", "-A");
  git(directory, "commit", "-m", "change");
}

const lines = (count, value = "const x = 1;") =>
  `${Array.from({ length: count }, () => value).join("\n")}\n`;

const scriptPath = fileURLToPath(
  new URL("./mutation-changed-lines.mjs", import.meta.url),
);
const fixtureDirectoryPrefix = "stryker-sql-fixtures-";
const fixtureEnvironment = "LLAME_STRYKER_SQL_FIXTURE_DIR";

function stagedFixtureDirectories() {
  return readdirSync(path.join(path.dirname(scriptPath), "..", "apps/api"))
    .filter((entry) => entry.startsWith(fixtureDirectoryPrefix))
    .sort();
}

test("an edited source line is mutated at that line, not as a whole file", () => {
  const directory = repository({
    [`${workspace}/src/a.ts`]: lines(20),
  });
  const edited = lines(20).split("\n");
  edited[9] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  const ranges = changedLineRanges("HEAD~1", directory);
  assert.deepEqual(ranges[workspace], [
    { file: "src/a.ts", ranges: [[10, 10]] },
  ]);
  assert.deepEqual(mutateRanges(ranges[workspace]), ["src/a.ts:10-10"]);
});

test("nearby edits coalesce into one range and distant ones stay separate", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(60) });
  const edited = lines(60).split("\n");
  for (const index of [4, 6, 40]) edited[index] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  assert.deepEqual(changedLineRanges("HEAD~1", directory)[workspace], [
    {
      file: "src/a.ts",
      ranges: [
        [5, 7],
        [41, 41],
      ],
    },
  ]);
});

test("inserted blank lines name no mutant, while an edit beside them still does", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(40) });
  const edited = lines(40).split("\n");
  for (const index of [5, 10, 15]) edited[index] = `\n${edited[index]}`;
  edited[30] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  assert.deepEqual(changedLineRanges("HEAD~1", directory)[workspace], [
    { file: "src/a.ts", ranges: [[34, 34]] },
  ]);
});

test("a file edited in many places stays a list of ranges, never the whole file", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(200) });
  const edited = lines(200).split("\n");
  for (let index = 0; index < 200; index += 20) edited[index] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  const ranges = mutateRanges(
    changedLineRanges("HEAD~1", directory)[workspace],
  );

  // Collapsing to `src/a.ts` would mutate the 190 lines this commit never
  // wrote, and their pre-existing survivors would fail the pull request.
  assert.equal(ranges.length, 10);
  assert.ok(!ranges.includes("src/a.ts"));
  assert.equal(ranges[0], "src/a.ts:1-1");
});

test("changes outside mutant sources select nothing", () => {
  const directory = repository({
    [`${workspace}/src/a.ts`]: lines(5),
    [`${workspace}/src/a.test.ts`]: lines(5),
    [`${workspace}/stryker.config.json`]: JSON.stringify({
      mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
    }),
  });
  commit(directory, {
    [`${workspace}/src/a.test.ts`]: lines(6),
    "apps/api/src/db/migrations/0001_example.sql":
      "CREATE TABLE a (id uuid);\n",
    "apps/api/src/testing/fixture.ts": lines(3),
    "docs/development/testing.md": "# docs\n",
    ".markdownlint-cli2.jsonc": "{}\n",
  });

  const ranges = changedLineRanges("HEAD~1", directory);
  assert.deepEqual(mutateRanges(ranges[workspace]), []);
  assert.deepEqual(mutateRanges(ranges["packages/config-interpolation"]), []);
});

test("a deletion-only edit contributes no range", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(20) });
  const edited = lines(20).split("\n");
  edited.splice(9, 3);
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  assert.deepEqual(
    mutateRanges(changedLineRanges("HEAD~1", directory)[workspace]),
    [],
  );
});

test("a new source file is mutated over its whole body", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(5) });
  commit(directory, { [`${workspace}/src/b.ts`]: lines(4) });

  assert.deepEqual(
    mutateRanges(changedLineRanges("HEAD~1", directory)[workspace]),
    ["src/b.ts:1-4"],
  );
});

test("the run goes through the workspace script that builds its dependencies", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(5) });
  writeFileSync(
    path.join(directory, workspace, "package.json"),
    JSON.stringify({
      name: "@workspace/runtime-safety",
      scripts: { "test:mutation": "stryker run" },
    }),
  );

  const arguments_ = mutationArguments(workspace, directory);

  // Stryker's TypeScript checker type-checks the whole program, so skipping
  // the script's dependency build leaves it unable to resolve a workspace
  // import and it aborts during initialization.
  assert.deepEqual(arguments_, [
    "run",
    "--filter",
    "@workspace/runtime-safety",
    "test:mutation",
    "stryker.changed-lines.json",
  ]);
  // `pnpm --filter X script -- --flag` forwards the separator into the script,
  // and `stryker run -- --flag` exits non-zero.
  assert.ok(!arguments_.includes("--"));
});

test("the scope travels in a config file, so no argv element can reach E2BIG", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(5) });
  const ranges = Array.from(
    { length: 4000 },
    (_, index) => `src/deeply/nested/module-${index}.ts:${index}-${index}`,
  );

  const file = writeScopeConfig(workspace, ranges, directory);
  const written = JSON.parse(readFileSync(file, "utf8"));

  // Linux caps a single argv element at 32 pages; this many ranges exceed it,
  // and `spawnSync` would return status null before Stryker started.
  assert.ok(ranges.join(",").length > 131072);
  assert.deepEqual(written.mutate, ranges);
  // The workspace's own settings survive, so the generated run differs from an
  // ordinary one only in scope, reporters, and the log it reads back.
  assert.equal(written.testRunner, "vitest");
  assert.deepEqual(written.reporters, [
    "clear-text",
    "html",
    "json",
    "progress-append-only",
  ]);
  assert.equal(written.fileLogLevel, "info");
});

// The log of a shard whose changed lines were an import and a bare call.
const emptyRunLog = [
  "02:17:17 (2930) INFO Instrumenter Instrumented 1 source file(s) with 0 mutant(s)",
  "02:18:08 (2930) ERROR Stryker No tests were executed. Stryker will exit prematurely.",
].join("\n");

/**
 * Runs `run` on a one-line source change with a `pnpm` that writes `log` as
 * Stryker's log and exits 1, after seeding `staleLog` from an earlier run.
 */
function runWithStrykerLog(log, staleLog) {
  const directory = repository({
    [`${workspace}/src/a.ts`]: lines(5),
    [`${workspace}/package.json`]: JSON.stringify({ name: "runtime-safety" }),
  });
  const edited = lines(5).split("\n");
  edited[2] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });
  const strykerLog = path.join(directory, workspace, "stryker.log");
  if (staleLog !== undefined) writeFileSync(strykerLog, staleLog);
  const bin = mkdtempSync(path.join(tmpdir(), "fake-pnpm-"));
  const pnpm = path.join(bin, "pnpm");
  writeFileSync(
    pnpm,
    `#!/bin/sh\nprintf '%s' "$FAKE_STRYKER_LOG" >> ${JSON.stringify(strykerLog)}\nexit 1\n`,
  );
  chmodSync(pnpm, 0o755);
  const result = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "mutation-changed-lines.mjs"),
      "run",
      "--workspace",
      workspace,
      "--base",
      "HEAD~1",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_STRYKER_LOG: log,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    leftovers: ["stryker.log", "stryker.changed-lines.json"].filter((file) =>
      existsSync(path.join(directory, workspace, file)),
    ),
  };
}

test("a run whose changed lines carry no mutant passes Stryker's empty-run abort", () => {
  const passed = runWithStrykerLog(emptyRunLog);

  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /the changed lines carry no mutant/u);
  assert.deepEqual(passed.leftovers, []);
});

test("a failed run with mutants, another failure, or only a stale log still fails", () => {
  // Mutants with no related test: nothing would kill them.
  const withMutants = emptyRunLog.replace(
    "with 0 mutant(s)",
    "with 3 mutant(s)",
  );
  assert.notEqual(runWithStrykerLog(withMutants).status, 0);
  // A zero count followed by another failure, such as a failing baseline test.
  const otherFailure = emptyRunLog.split("\n")[0] ?? "";
  assert.notEqual(runWithStrykerLog(otherFailure).status, 0);
  // A zero-mutant log left by an interrupted earlier run does not count.
  const stale = runWithStrykerLog(withMutants, emptyRunLog);
  assert.notEqual(stale.status, 0);
  assert.deepEqual(stale.leftovers, []);
});

test("canonical Stryker exclusions apply to the changed-lines scope", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-source-"));
  try {
    mkdirSync(path.join(directory, "src/testing"), { recursive: true });
    mkdirSync(path.join(directory, "src/mcp"), { recursive: true });
    for (const file of [
      "a.ts",
      "a.test.ts",
      "testing/support.ts",
      "mcp/mcp-runtime.module.ts",
    ]) {
      writeFileSync(
        path.join(directory, "src", file),
        "export const value = 1;\n",
      );
    }
    writeFileSync(
      path.join(directory, "stryker.config.json"),
      JSON.stringify({
        mutate: [
          "src/**/*.ts",
          "!src/**/*.test.ts",
          "!src/testing/**",
          "!src/mcp/mcp-runtime.module.ts",
        ],
      }),
    );
    assert.deepEqual(mutationSourceFiles(directory), ["src/a.ts"]);
    writeFileSync(
      path.join(directory, "src/a,b.ts"),
      "export const value = 2;\n",
    );
    assert.throws(
      () => mutationSourceFiles(directory),
      /glob metacharacters or commas/u,
    );
    writeFileSync(
      path.join(directory, "stryker.config.json"),
      JSON.stringify({ mutate: ["missing/**/*.ts"] }),
    );
    assert.throws(
      () => mutationSourceFiles(directory),
      /Configured mutation scope is empty/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

test("shards cover every changed file exactly once, heaviest files spread first", () => {
  const entries = [
    { file: "src/a.ts", ranges: [[1, 100]] },
    { file: "src/b.ts", ranges: [[1, 60]] },
    {
      file: "src/c.ts",
      ranges: [
        [1, 20],
        [40, 59],
      ],
    },
    { file: "src/d.ts", ranges: [[5, 5]] },
    { file: "src/e.ts", ranges: [[1, 30]] },
  ];
  const shards = [1, 2, 3].map((index) => shardEntries(entries, index, 3));

  assert.deepEqual(
    shards.map((shard) => shard.map(({ file }) => file)),
    [["src/a.ts"], ["src/b.ts", "src/d.ts"], ["src/c.ts", "src/e.ts"]],
  );
  assert.deepEqual(
    shardEntries([...entries].reverse(), 2, 3),
    shards[1],
    "the partition must not depend on input order, or shards would disagree",
  );
  assert.deepEqual(shardEntries(entries, 1, 1), entries);
});

test("a shard outside its count is refused rather than silently empty", () => {
  for (const [index, count] of [
    [0, 3],
    [4, 3],
    [1, 0],
    [Number.NaN, 2],
  ])
    assert.throws(() => shardEntries([], index, count), /Invalid shard/u);
});

test("with-sql-fixtures stages fixtures for the command and cleans up on either exit", () => {
  const root = path.resolve(path.dirname(scriptPath), "..");
  const api = path.join(root, "apps/api");
  const before = stagedFixtureDirectories();
  const run = spawnSync(
    process.execPath,
    [
      scriptPath,
      "with-sql-fixtures",
      process.execPath,
      "-e",
      `console.log(JSON.stringify({
        fixtureDirectory: process.env.${fixtureEnvironment},
        files: require("node:fs").readdirSync(process.env.${fixtureEnvironment}).sort(),
        contents: Object.fromEntries(require("node:fs").readdirSync(process.env.${fixtureEnvironment}).map(
          (file) => [file, require("node:fs").readFileSync(require("node:path").join(process.env.${fixtureEnvironment}, file), "utf8")]
        )),
        cwd: process.cwd(),
      }))`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, [fixtureEnvironment]: "parent-value" },
    },
  );

  assert.equal(run.status, 0, run.stderr);
  const observed = JSON.parse(run.stdout);
  assert.equal(observed.cwd, root);
  assert.notEqual(observed.fixtureDirectory, "parent-value");
  assert.equal(path.dirname(observed.fixtureDirectory), api);
  assert.ok(
    path.basename(observed.fixtureDirectory).startsWith(fixtureDirectoryPrefix),
  );
  assert.deepEqual(observed.files, [
    "03-vector-extension.sql",
    "rls-function-owner.sql",
  ]);
  for (const [source, staged] of [
    [
      "docker/postgres/initdb/03-vector-extension.sql",
      "03-vector-extension.sql",
    ],
    ["docker/postgres/rls-function-owner.sql", "rls-function-owner.sql"],
  ])
    assert.equal(
      observed.contents[staged],
      readFileSync(path.join(root, source), "utf8"),
    );
  assert.deepEqual(stagedFixtureDirectories(), before);

  const failed = spawnSync(
    process.execPath,
    [
      scriptPath,
      "with-sql-fixtures",
      process.execPath,
      "-e",
      "process.exit(23)",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(failed.status, 23, failed.stderr);
  assert.deepEqual(stagedFixtureDirectories(), before);

  const missingCommand = spawnSync(
    process.execPath,
    [
      scriptPath,
      "with-sql-fixtures",
      "/definitely/missing/stryker-fixture-command",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(missingCommand.status, 0);
  assert.match(missingCommand.stderr, /ENOENT/u);
  assert.deepEqual(stagedFixtureDirectories(), before);
});
