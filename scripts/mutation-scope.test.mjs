import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  changedFiles,
  mergeMutationBaseline,
  mutationBaseline,
  mutationFingerprint,
  mutationSourceFiles,
  selectMutationScope,
} from "./mutation-scope.mjs";

// A hook may use a temporary index in the parent repository. Fixture Git
// commands must never inherit that index or another repository's Git directory.
for (const variable of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")) {
  delete process.env[variable];
}
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "core.excludesFile";
process.env.GIT_CONFIG_VALUE_0 = "/dev/null";

const sources = {
  "apps/api": ["src/a.ts", "src/b.ts"],
  "packages/config-interpolation": ["src/interpolation.ts"],
  "packages/runtime-safety": ["src/redact.ts"],
};

test("source edits select complete files without including other workspaces", () => {
  assert.deepEqual(selectMutationScope(["apps/api/src/b.ts"], sources), {
    "apps/api": { mode: "scoped", files: ["src/b.ts"] },
    "packages/config-interpolation": { mode: "skip", files: [] },
    "packages/runtime-safety": { mode: "skip", files: [] },
  });
});

test("a baseline narrows test edits to the mutant files those tests cover", () => {
  const baseline = {
    "apps/api": {
      files: {
        "src/a.ts": { mutants: 4, undetected: 1, coveredBy: ["src/a.test.ts"] },
        "src/b.ts": {
          mutants: 2,
          undetected: 0,
          coveredBy: ["src/a.test.ts", "src/b.test.ts"],
        },
      },
    },
  };
  assert.deepEqual(
    selectMutationScope(["apps/api/src/a.test.ts"], sources, baseline)[
      "apps/api"
    ],
    { mode: "scoped", files: ["src/a.ts", "src/b.ts"] },
  );
  // A deleted test file still selects what it used to cover: that is the case
  // a scope built from source edits alone would silently skip.
  assert.deepEqual(
    selectMutationScope(["apps/api/src/removed.test.ts"], sources, {
      "apps/api": {
        files: {
          "src/b.ts": {
            mutants: 2,
            undetected: 0,
            coveredBy: ["src/removed.test.ts"],
          },
        },
      },
    })["apps/api"],
    { mode: "scoped", files: ["src/b.ts"] },
  );
  // A test the baseline credits with no coverage can flip no mutant it
  // measured, so editing it cannot GAIN an undetected mutant and it
  // contributes nothing instead of making the scope unbounded. Both real
  // populations land here: a test the pull request adds, and a test the
  // mutation run never executes (an integration test the runner excludes),
  // which can never be indexed at any revision.
  assert.deepEqual(
    selectMutationScope(["apps/api/src/unrelated.test.ts"], sources, baseline)[
      "apps/api"
    ],
    { mode: "skip", files: [] },
  );
  // Absent evidence is not absent coverage: an index that measured no mutants
  // bounds nothing, and the plan names that failure differently from a missing
  // index so an operator can tell the two apart.
  const noMutants = selectMutationScope(
    ["apps/api/src/unrelated.test.ts"],
    sources,
    { "apps/api": { files: {} } },
  )["apps/api"];
  assert.equal(noMutants.mode, "unavailable");
  assert.match(noMutants.reason, /measured no mutants/u);
  // An index that measured mutants yet credits no test — every mutant
  // uncovered — still bounds this change, so the same edit is skipped rather
  // than failing the plan.
  assert.equal(
    selectMutationScope(["apps/api/src/unrelated.test.ts"], sources, {
      "apps/api": {
        files: {
          "src/a.ts": { mutants: 3, undetected: 3, coveredBy: [] },
        },
      },
    })["apps/api"].mode,
    "skip",
  );
  assert.equal(
    selectMutationScope(["apps/api/src/a.test.ts"], sources, {
      "apps/api": {
        files: {
          "src/deleted.ts": {
            mutants: 1,
            undetected: 1,
            coveredBy: ["src/a.test.ts"],
          },
        },
      },
    })["apps/api"].mode,
    "skip",
  );
});

test("a test edit without a baseline schedules no mutation files", () => {
  const scope = selectMutationScope(["apps/api/src/a.test.ts"], sources)[
    "apps/api"
  ];
  assert.equal(scope.mode, "unavailable");
  assert.deepEqual(scope.files, []);
});

test("baseline reading normalizes test ids, counts and undetected mutants", () => {
  const baseline = mutationBaseline([
    {
      schemaVersion: "1.0",
      testFiles: {
        "src/a.test.ts": { tests: [{ id: "4", name: "covers a" }] },
      },
      files: {
        "src/a.ts": {
          mutants: [
            { status: "Killed", coveredBy: ["4"] },
            { status: "Survived", coveredBy: ["4"] },
            { status: "NoCoverage" },
            { status: "Ignored" },
            { status: "CompileError", coveredBy: [] },
          ],
        },
      },
    },
  ]);
  assert.deepEqual(baseline.files["src/a.ts"], {
    mutants: 4,
    undetected: 2,
    coveredBy: ["src/a.test.ts"],
  });

  const merged = mergeMutationBaseline(
    {
      files: {
        "src/kept.ts": { mutants: 9, undetected: 9, coveredBy: [] },
        "src/a.ts": {
          mutants: 1,
          undetected: 1,
          coveredBy: ["src/other.test.ts"],
        },
      },
    },
    [
      {
        files: {
          "src/a.ts": {
            mutants: [{ status: "Killed", coveredBy: ["src/a.test.ts"] }],
          },
        },
      },
    ],
  );
  assert.deepEqual(Object.keys(merged.files).sort(), [
    "src/a.ts",
    "src/kept.ts",
  ]);
  // The later measurement replaces the counts, but not the coverage a narrower
  // dry run could not have seen.
  assert.deepEqual(merged.files["src/a.ts"], {
    mutants: 1,
    undetected: 0,
    coveredBy: ["src/a.test.ts", "src/other.test.ts"],
  });
});

test("an unread `src` asset is inert while run configuration is unbounded", () => {
  // No baseline, so anything credited to a reader is unbounded.
  for (const file of ["src/a.test.ts", "src/prompts/chat-default.md"]) {
    const scope = selectMutationScope(
      [`apps/api/${file}`, "apps/api/src/a.ts"],
      sources,
    )["apps/api"];
    assert.equal(scope.mode, "unavailable");
    assert.deepEqual(scope.files, []);
  }
  // A deleted mutant source cannot regress: its mutants are gone. A module the
  // mutation run never mutates, and an asset no mutation-run test reads, are
  // equally inert — all previously unbounded. The empty root stands in for a
  // revision where nothing reads them; the temp-repo test below covers a real
  // reader.
  const empty = mkdtempSync(path.join(tmpdir(), "llame-mutation-empty-"));
  try {
    for (const file of [
      "src/deleted.ts",
      "src/mcp/mcp-runtime.module.ts",
      "src/db/migrations/20260913164029_x.sql",
    ]) {
      const scope = selectMutationScope(
        [`apps/api/${file}`],
        sources,
        {},
        empty,
      )["apps/api"];
      assert.equal(scope.mode, "skip");
      assert.deepEqual(scope.files, []);
    }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  // A workspace-root file is build or run configuration, and no test reads it.
  for (const file of ["vitest.config.mts", "tsconfig.json"]) {
    const scope = selectMutationScope([`apps/api/${file}`], sources)[
      "apps/api"
    ];
    assert.equal(scope.mode, "unavailable");
    assert.deepEqual(scope.files, []);
  }
});

test("shared runtime changes cannot claim a scoped API delta", () => {
  const result = selectMutationScope(
    ["packages/runtime-safety/src/redact.ts"],
    sources,
  );
  assert.deepEqual(result["packages/runtime-safety"], {
    mode: "scoped",
    files: ["src/redact.ts"],
  });
  assert.equal(result["apps/api"].mode, "unavailable");
  assert.deepEqual(result["apps/api"].files, []);
  assert.equal(result["packages/config-interpolation"].mode, "skip");
  for (const dependency of ["native-file-tools", "bash-executor"]) {
    assert.equal(
      selectMutationScope([`packages/${dependency}/src/index.ts`], sources)[
        "apps/api"
      ].mode,
      "unavailable",
    );
  }
});

test("dependency test edits do not expand API mutation scope", () => {
  const baseline = {
    "apps/api": {
      files: {
        "src/a.ts": { mutants: 4, undetected: 1, coveredBy: ["src/a.test.ts"] },
      },
    },
    "packages/runtime-safety": {
      files: {
        "src/redact.ts": {
          mutants: 2,
          undetected: 0,
          coveredBy: ["src/redact.test.ts"],
        },
      },
    },
  };
  const result = selectMutationScope(
    [
      "apps/api/src/a.test.ts",
      "packages/native-file-tools/src/read.test.ts",
      "packages/bash-executor/src/execute.test.ts",
      "packages/runtime-safety/src/redact.test.ts",
    ],
    sources,
    baseline,
  );
  assert.deepEqual(result["apps/api"], {
    mode: "scoped",
    files: ["src/a.ts"],
  });
  assert.deepEqual(result["packages/runtime-safety"], {
    mode: "scoped",
    files: ["src/redact.ts"],
  });
});

test("baselines invalidate on configuration, not on fixture or artifact content", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-cache-"));
  const files = {
    "apps/api/package.json": JSON.stringify({
      dependencies: { "@workspace/runtime-safety": "workspace:*" },
    }),
    "apps/api/stryker.config.json": JSON.stringify({
      mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/excluded.ts"],
      vitest: { configFile: "vitest.mutation.config.mts" },
    }),
    "apps/api/vitest.mutation.config.mts": "export default {};\n",
    "apps/api/src/a.ts": "export const value = 1;\n",
    "apps/api/src/a.test.ts": "test('value', () => {});\n",
    "apps/api/src/example.test-fixture.ts": "export const fixture = 1;\n",
    "apps/api/src/excluded.ts": "export const excluded = 1;\n",
    "apps/api/src/prompt.md": "runtime input\n",
    "apps/api/README.md": "documentation\n",
    "packages/runtime-safety/package.json": JSON.stringify({
      devDependencies: { "@workspace/config-typescript": "workspace:*" },
    }),
    "packages/runtime-safety/src/index.ts": "export const dependency = 1;\n",
    "packages/runtime-safety/src/index.test.ts":
      "test('dependency', () => {});\n",
    "packages/config-typescript/package.json": "{}\n",
    "packages/config-typescript/base.json": "{}\n",
    "apps/web/app/page.tsx": "export const page = 1;\n",
    "repository-input.json": "{}\n",
    ".github/workflows/ci.yml": "name: CI\n",
    ".gitignore": "reports/\n",
    "scripts/mutation-scope.mjs": "export const version = 1;\n",
  };
  try {
    execFileSync("git", ["init", "--initial-branch=master"], {
      cwd: directory,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "core.autocrlf", "false"], {
      cwd: directory,
    });
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), source);
    }
    execFileSync("git", ["add", "."], { cwd: directory });
    const baseline = mutationFingerprint("apps/api", directory);
    // Source, tests, docs, frontend, CI wiring, gitignore — and now every input a
    // changed file is scoped by rather than refused: a fixture, a file outside
    // the mutation set, and prompt markdown.
    for (const file of [
      "apps/api/src/a.ts",
      "apps/api/src/a.test.ts",
      "packages/runtime-safety/src/index.test.ts",
      "apps/api/src/example.test-fixture.ts",
      "apps/api/src/excluded.ts",
      "apps/api/src/prompt.md",
      "scripts/mutation-scope.mjs",
      "apps/api/README.md",
      "apps/web/app/page.tsx",
      ".github/workflows/ci.yml",
      ".gitignore",
    ]) {
      writeFileSync(path.join(directory, file), `${files[file]}// changed\n`);
      assert.equal(mutationFingerprint("apps/api", directory), baseline, file);
    }
    for (const file of [
      "apps/api/stryker.config.json",
      "apps/api/vitest.mutation.config.mts",
      "apps/api/package.json",
      "packages/runtime-safety/src/index.ts",
      "packages/config-typescript/base.json",
      "repository-input.json",
    ]) {
      // Keep JSON valid so the manifest is still parseable while probed.
      writeFileSync(
        path.join(directory, file),
        file.endsWith(".json")
          ? JSON.stringify({ ...JSON.parse(files[file]), probe: 1 })
          : `${files[file]}changed\n`,
      );
      assert.notEqual(
        mutationFingerprint("apps/api", directory),
        baseline,
        file,
      );
      writeFileSync(path.join(directory, file), files[file]);
    }
    writeFileSync(path.join(directory, "new-runtime-input.txt"), "new input\n");
    assert.notEqual(mutationFingerprint("apps/api", directory), baseline);
    writeFileSync(path.join(directory, "repository-input.json"), "<deleted>");
    const beforeDeletion = mutationFingerprint("apps/api", directory);
    rmSync(path.join(directory, "repository-input.json"));
    assert.notEqual(mutationFingerprint("apps/api", directory), beforeDeletion);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unknown runtime inputs make every workspace delta unavailable", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "package.json",
    "new-runtime/input.txt",
  ]) {
    assert.deepEqual(
      Object.values(selectMutationScope([file], sources)).map(
        (scope) => scope.mode,
      ),
      ["unavailable", "unavailable", "unavailable"],
    );
  }
});

test("a workspace reports every unbounded input, not only the last", () => {
  // A waiver records what it left unmeasured, so the reason must not collapse
  // to whichever path happened to be visited last.
  // Workspace-root files are run configuration that no test reads, which is the
  // remaining unbounded case.
  const scope = selectMutationScope(
    [
      "apps/api/tsconfig.json",
      "apps/api/vitest.config.mts",
      "apps/api/tsconfig.build.json",
    ],
    sources,
  )["apps/api"];
  assert.equal(scope.mode, "unavailable");
  for (const path of [
    "tsconfig.json",
    "vitest.config.mts",
    "tsconfig.build.json",
  ])
    assert.match(scope.reason, new RegExp(path.replace(".", "\\.", "gu"), "u"));
});

test("documentation, frontend, tooling and lint configuration need no mutation execution", () => {
  const result = selectMutationScope(
    [
      "README.md",
      "docs/testing.md",
      "openspec/specs/a/spec.md",
      ".agents/notes/local.md",
      "apps/api/README.md",
      "apps/web/app/page.tsx",
      "packages/ui/src/button.tsx",
      ".github/workflows/ci.yml",
      ".gitignore",
      "scripts/mutation-scope.mjs",
      "scripts/mutation-sharding.test.mjs",
      "apps/api/stryker.config.json",
      // Lint and format configuration reads source text and never runs during a
      // test, so it cannot move a mutant — including inside a workspace, where
      // it would otherwise be an unbounded non-source input.
      ".markdownlint-cli2.jsonc",
      ".oxlintrc.json",
      "apps/api/.oxlintrc.json",
      "apps/api/.prettierrc",
      ".prettierignore",
    ],
    sources,
  );
  assert.deepEqual(
    Object.values(result).map((scope) => scope.mode),
    ["skip", "skip", "skip"],
  );
});

test("canonical Stryker exclusions also apply to sharded and changed scopes", () => {
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

test("Git scope includes branch, staged, unstaged, untracked, renamed and deleted paths", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-git-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git("init", "--initial-branch=master");
    git("config", "user.name", "Mutation scope test");
    git("config", "user.email", "mutation-scope@example.invalid");
    git("config", "core.autocrlf", "false");
    for (const file of [
      "branch.ts",
      "staged.ts",
      "unstaged.ts",
      "deleted.ts",
      "old name.ts",
    ])
      writeFileSync(path.join(directory, file), "original\n");
    git("add", ".");
    git("commit", "-m", "Initial fixture");
    git("checkout", "-b", "change");
    writeFileSync(path.join(directory, "branch.ts"), "branch edit\n");
    git("add", "branch.ts");
    git("commit", "-m", "Branch edit");
    git("checkout", "master");
    writeFileSync(
      path.join(directory, "base-only.ts"),
      "not part of the change\n",
    );
    git("add", ".");
    git("commit", "-m", "Advance base");
    git("checkout", "change");
    writeFileSync(path.join(directory, "staged.ts"), "staged edit\n");
    git("add", "staged.ts");
    writeFileSync(path.join(directory, "unstaged.ts"), "unstaged edit\n");
    writeFileSync(path.join(directory, "untracked.ts"), "new source\n");
    renameSync(
      path.join(directory, "old name.ts"),
      path.join(directory, "new name.ts"),
    );
    rmSync(path.join(directory, "deleted.ts"));
    assert.deepEqual(changedFiles("master", directory), [
      "branch.ts",
      "deleted.ts",
      "new name.ts",
      "old name.ts",
      "staged.ts",
      "unstaged.ts",
      "untracked.ts",
    ]);
    assert.throws(() => changedFiles("missing-base", directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("trusted plans include changes from a cancelled predecessor run", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-resume-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "--initial-branch=master");
    git("config", "user.name", "Mutation scope test");
    git("config", "user.email", "mutation-scope@example.invalid");
    writeFileSync(path.join(directory, ".gitignore"), "**/reports/\n");
    for (const [workspace, files] of Object.entries(sources)) {
      mkdirSync(path.join(directory, workspace, "src"), { recursive: true });
      writeFileSync(
        path.join(directory, workspace, "stryker.config.json"),
        JSON.stringify({ mutate: ["src/**/*.ts"] }),
      );
      for (const file of files)
        writeFileSync(
          path.join(directory, workspace, file),
          "export const n = 1;\n",
        );
    }
    git("add", ".");
    git("commit", "-m", "Measured baseline");
    const revision = git("rev-parse", "HEAD");
    mkdirSync(path.join(directory, "apps/api/reports"));
    writeFileSync(
      path.join(directory, "apps/api/reports/mutation-baseline.json"),
      JSON.stringify({
        baselineVersion: 2,
        revision,
        files: {
          "src/a.ts": { mutants: 1, undetected: 0, coveredBy: [] },
          "src/b.ts": { mutants: 1, undetected: 0, coveredBy: [] },
        },
      }),
    );
    writeFileSync(
      path.join(directory, "apps/api/src/a.ts"),
      "export const n = 2;\n",
    );
    git("add", ".");
    git("commit", "-m", "Cancelled measurement");
    const before = git("rev-parse", "HEAD");
    writeFileSync(
      path.join(directory, "apps/api/src/b.ts"),
      "export const n = 2;\n",
    );
    git("add", ".");
    git("commit", "-m", "Next master push");
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.resolve("scripts/mutation-sharding.mjs"),
          "plan",
          "--base",
          before,
          "--from-baseline",
        ],
        { cwd: directory, encoding: "utf8" },
      ).trim(),
    );
    assert.equal(result.apiMode, "scoped");
    assert.deepEqual(result.apiShards.flatMap((shard) => shard.files).sort(), [
      "src/a.ts",
      "src/b.ts",
    ]);

    const run = (...args) =>
      execFileSync(
        process.execPath,
        [path.resolve("scripts/mutation-sharding.mjs"), ...args],
        { cwd: directory, encoding: "utf8" },
      );
    const report = path.join(directory, "apps/api/reports/current.json");
    const oldReport = path.join(directory, "apps/api/reports/old.json");
    const latest = path.join(directory, "apps/api/reports/latest.json");
    for (const [file, status] of [
      [report, "Survived"],
      [oldReport, "Killed"],
    ]) {
      writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: "1.0",
          files: { "src/a.ts": { mutants: [{ id: "0", status }] } },
        }),
      );
    }
    run("baseline", "--output", latest, report);
    git("checkout", "--detach", before);
    copyFileSync(
      latest,
      path.join(directory, "apps/api/reports/mutation-baseline.json"),
    );
    assert.throws(
      () => run("plan", "--base", revision),
      /mutation delta unavailable/u,
    );
    run("baseline", "--previous", latest, "--output", latest, oldReport);
    // An older completion must not reset the newer allowance to zero.
    assert.match(
      run("aggregate", "--baseline", latest, report),
      /No new undetected mutants/u,
    );

    const unreachable = JSON.stringify({
      baselineVersion: 2,
      revision: "f".repeat(40),
      files: { "src/a.ts": { mutants: 1, undetected: 0, coveredBy: [] } },
    });
    writeFileSync(latest, unreachable);
    writeFileSync(
      path.join(directory, "apps/api/reports/mutation-baseline.json"),
      unreachable,
    );
    writeFileSync(
      path.join(directory, "apps/api/src/a.ts"),
      "export const n = 3;\n",
    );
    assert.throws(
      () => run("plan", "--base", before, "--from-baseline"),
      /mutation delta unavailable/u,
    );
    run("baseline", "--previous", latest, "--output", latest, report);
    assert.match(
      run("aggregate", "--baseline", latest, report),
      /No new undetected mutants/u,
    );

    copyFileSync(
      latest,
      path.join(directory, "apps/api/reports/mutation-baseline.json"),
    );
    git("checkout", "--orphan", "unrelated");
    git("commit", "--allow-empty", "-m", "Unrelated repository history");
    writeFileSync(
      path.join(directory, "apps/api/src/a.ts"),
      "export const n = 4;\n",
    );
    assert.throws(
      () => run("plan", "--base", "HEAD"),
      /mutation delta unavailable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a changed input is bounded by the mutation-run tests that read it", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-reader-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.resolve("scripts/mutation-sharding.mjs"), ...args],
      { cwd: directory, encoding: "utf8" },
    );
  const write = (relative, body) => {
    mkdirSync(path.dirname(path.join(directory, relative)), {
      recursive: true,
    });
    writeFileSync(path.join(directory, relative), body);
  };
  try {
    git("init", "--initial-branch=master");
    git("config", "user.name", "Mutation scope test");
    git("config", "user.email", "mutation-scope@example.invalid");
    for (const [workspace, files] of Object.entries(sources)) {
      write(
        `${workspace}/stryker.config.json`,
        // The real config excludes tests and test support from mutation, which
        // is what makes a fixture a bounded input rather than a source.
        JSON.stringify({
          mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/testing/**"],
        }),
      );
      for (const file of files)
        write(`${workspace}/${file}`, "export const n = 1;\n");
      write(
        `${workspace}/package.json`,
        JSON.stringify({ scripts: { "test:mutation:report": "command" } }),
      );
    }
    write(
      "package.json",
      JSON.stringify({ scripts: { "test:mutation:report": "command" } }),
    );
    // The index is ignored, so writing it does not enter the change set.
    write(".gitignore", "reports/\n");
    write("apps/api/src/a.ts", "export const a = 1;\n");
    // The fixture is read only by a.test.ts, and only through that test can a
    // change to it move a mutant.
    write("apps/api/src/a.test.ts", "import '../testing/fixture';\n");
    write("apps/api/src/testing/fixture.ts", "export const f = 1;\n");
    git("add", ".");
    git("commit", "-m", "Base mutation inputs");
    const base = git("rev-parse", "HEAD");
    write(
      "apps/api/reports/mutation-baseline.json",
      JSON.stringify({
        baselineVersion: 2,
        revision: base,
        files: {
          "src/a.ts": {
            mutants: 3,
            undetected: 1,
            coveredBy: ["src/a.test.ts"],
          },
        },
      }),
    );

    write("apps/api/src/testing/fixture.ts", "export const f = 2;\n");
    const read = run("plan", "--base", base);
    assert.equal(read.status, 0, read.stderr);
    const plan = JSON.parse(read.stdout);
    assert.equal(plan.apiMode, "scoped");
    assert.deepEqual(
      plan.apiShards.flatMap((shard) => shard.files),
      ["src/a.ts"],
    );

    // A fixture no mutation-run test reads cannot move anything. Fresh base, so
    // only this file is in the change set.
    git("add", ".");
    git("commit", "-m", "Measured the read fixture");
    const base2 = git("rev-parse", "HEAD");
    write("apps/api/src/testing/unread.ts", "export const u = 1;\n");
    git("add", ".");
    git("commit", "-m", "Add an unread fixture");
    write("apps/api/src/testing/unread.ts", "export const u = 2;\n");
    const unread = run("plan", "--base", base2);
    assert.equal(unread.status, 0, unread.stderr);
    assert.equal(JSON.parse(unread.stdout).apiMode, "skip");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cold plans skip mutation tooling but reject missing delta evidence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-cold-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.resolve("scripts/mutation-sharding.mjs"), ...args],
      { cwd: directory, encoding: "utf8" },
    );
  try {
    git("init", "--initial-branch=master");
    git("config", "user.name", "Mutation scope test");
    git("config", "user.email", "mutation-scope@example.invalid");
    for (const [workspace, files] of Object.entries(sources)) {
      mkdirSync(path.join(directory, workspace, "src"), { recursive: true });
      writeFileSync(
        path.join(directory, workspace, "stryker.config.json"),
        JSON.stringify({ mutate: ["src/**/*.ts"] }),
      );
      for (const file of files)
        writeFileSync(
          path.join(directory, workspace, file),
          "export const n = 1;\n",
        );
    }
    for (const manifest of ["package.json", "apps/api/package.json"])
      writeFileSync(
        path.join(directory, manifest),
        JSON.stringify({ scripts: { "test:mutation:check": "old command" } }),
      );
    git("add", ".");
    git("commit", "-m", "Initial mutation inputs");
    const base = git("rev-parse", "HEAD");

    writeFileSync(
      path.join(directory, "apps/api/src/a.ts"),
      "export const n = 2;\n",
    );
    for (const command of ["plan", "changed"]) {
      const missing = run(command, "--base", base);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /mutation delta unavailable/u);
    }
    // An operator waiver turns the same failure into a recorded skip rather
    // than a silent pass: the annotation names what went unmeasured, and the
    // workspace schedules no shards.
    const waived = run("plan", "--base", base, "--bypass");
    assert.equal(waived.status, 0);
    assert.match(
      waived.stdout,
      /::warning title=Mutation gate bypassed::apps\/api: No compatible ancestor mutation baseline/u,
    );
    assert.equal(
      JSON.parse(waived.stdout.trim().split("\n").at(-1)).apiMode,
      "skip",
    );
    writeFileSync(
      path.join(directory, "apps/api/src/a.ts"),
      "export const n = 1;\n",
    );
    const mutationScripts = {
      scripts: { "test:mutation:report": "new command" },
    };
    for (const manifest of ["package.json", "apps/api/package.json"])
      writeFileSync(
        path.join(directory, manifest),
        JSON.stringify(mutationScripts),
      );
    mkdirSync(path.join(directory, ".github/workflows"), { recursive: true });
    writeFileSync(
      path.join(directory, ".github/workflows/ci.yml"),
      "name: CI\n",
    );
    const tooling = run("plan", "--base", base, "--from-baseline");
    assert.equal(tooling.status, 0, tooling.stderr);
    const plan = JSON.parse(tooling.stdout);
    assert.deepEqual(plan.apiShards, []);
    assert.equal(plan.apiMode, "skip");
    assert.ok(plan.packages.every((workspace) => workspace.mode === "skip"));

    const manual = run("plan", "--full");
    assert.equal(manual.status, 0, manual.stderr);
    assert.deepEqual(
      JSON.parse(manual.stdout)
        .apiShards.flatMap((shard) => shard.files)
        .sort(),
      sources["apps/api"],
    );

    writeFileSync(
      path.join(directory, "apps/api/package.json"),
      JSON.stringify({
        ...mutationScripts,
        dependencies: { dependency: "2.0.0" },
      }),
    );
    const runtime = run("plan", "--base", base);
    assert.equal(runtime.status, 1);
    assert.match(runtime.stderr, /mutation delta unavailable/u);
    writeFileSync(
      path.join(directory, "apps/api/package.json"),
      JSON.stringify(mutationScripts),
    );
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        scripts: { ...mutationScripts.scripts, build: "changed build" },
      }),
    );
    const build = run("plan", "--base", base);
    assert.equal(build.status, 1);
    assert.match(build.stderr, /mutation delta unavailable/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
