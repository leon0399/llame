import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  changedLineRanges,
  mutateArgument,
  mutationArguments,
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
      JSON.stringify({ mutate: ["src/**/*.ts", "!src/**/*.test.ts"] }),
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
  assert.equal(mutateArgument(ranges[workspace]), "src/a.ts:10-10");
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

test("a file edited in more places than the range cap is mutated whole", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(200) });
  const edited = lines(200).split("\n");
  for (let index = 0; index < 200; index += 20) edited[index] = "const x = 2;";
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  assert.equal(
    mutateArgument(changedLineRanges("HEAD~1", directory)[workspace]),
    "src/a.ts",
  );
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
    "docs/testing.md": "# docs\n",
    ".markdownlint-cli2.jsonc": "{}\n",
  });

  const ranges = changedLineRanges("HEAD~1", directory);
  assert.equal(mutateArgument(ranges[workspace]), undefined);
  assert.equal(
    mutateArgument(ranges["packages/config-interpolation"]),
    undefined,
  );
});

test("a deletion-only edit contributes no range", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(20) });
  const edited = lines(20).split("\n");
  edited.splice(9, 3);
  commit(directory, { [`${workspace}/src/a.ts`]: edited.join("\n") });

  assert.equal(
    mutateArgument(changedLineRanges("HEAD~1", directory)[workspace]),
    undefined,
  );
});

test("a new source file is mutated over its whole body", () => {
  const directory = repository({ [`${workspace}/src/a.ts`]: lines(5) });
  commit(directory, { [`${workspace}/src/b.ts`]: lines(4) });

  assert.equal(
    mutateArgument(changedLineRanges("HEAD~1", directory)[workspace]),
    "src/b.ts:1-4",
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

  const arguments_ = mutationArguments(workspace, "src/a.ts:1-2", directory);

  // Stryker's TypeScript checker type-checks the whole program, so skipping
  // the script's dependency build leaves it unable to resolve a workspace
  // import and it aborts during initialization.
  assert.deepEqual(arguments_.slice(0, 4), [
    "run",
    "--filter",
    "@workspace/runtime-safety",
    "test:mutation",
  ]);
  // `pnpm --filter X script -- --flag` forwards the separator into the script,
  // and `stryker run -- --flag` exits non-zero.
  assert.ok(!arguments_.includes("--"));
  assert.deepEqual(arguments_.slice(4, 6), ["--mutate", "src/a.ts:1-2"]);
});
