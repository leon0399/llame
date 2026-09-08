import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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

const sources = {
  "apps/api": ["src/a.ts", "src/b.ts"],
  "packages/config-interpolation": ["src/interpolation.ts"],
  "packages/runtime-safety": ["src/redact.ts"],
};

test("source edits select complete files without including other workspaces", () => {
  assert.deepEqual(selectMutationScope(["apps/api/src/b.ts"], sources), {
    "apps/api": { mode: "changed", files: ["src/b.ts"] },
    "packages/config-interpolation": { mode: "skip", files: [] },
    "packages/runtime-safety": { mode: "skip", files: [] },
  });
});

test("tests, deleted source, excluded source and runtime fixtures expand their workspace", () => {
  for (const file of [
    "src/a.test.ts",
    "src/deleted.ts",
    "src/mcp/mcp-runtime.module.ts",
    "src/prompts/chat-default.md",
    "vitest.config.mts",
  ]) {
    assert.deepEqual(
      selectMutationScope([`apps/api/${file}`, "apps/api/src/a.ts"], sources)[
        "apps/api"
      ],
      {
        mode: "full",
        files: ["src/a.ts", "src/b.ts"],
      },
    );
  }
});

test("shared package edits include the complete dependent API scope", () => {
  const result = selectMutationScope(
    ["packages/runtime-safety/src/redact.ts"],
    sources,
  );
  assert.deepEqual(result["packages/runtime-safety"], {
    mode: "changed",
    files: ["src/redact.ts"],
  });
  assert.deepEqual(result["apps/api"], {
    mode: "full",
    files: ["src/a.ts", "src/b.ts"],
  });
  assert.equal(result["packages/config-interpolation"].mode, "skip");
  for (const dependency of ["native-file-tools", "bash-executor"]) {
    assert.equal(
      selectMutationScope([`packages/${dependency}/src/index.ts`], sources)[
        "apps/api"
      ].mode,
      "full",
    );
  }
});

test("mutated fixtures and test doubles expand the complete workspace", () => {
  for (const file of [
    "src/runs/model-context-snapshot.test-fixture.ts",
    "src/mcp/mcp-test-fixture.ts",
    "src/models/fake-model-client.ts",
    "src/search/embedding-stub.ts",
    "src/search/chat/eval/dataset.ts",
  ]) {
    const result = selectMutationScope([`apps/api/${file}`], {
      ...sources,
      "apps/api": ["src/a.ts", file],
    });
    assert.equal(result["apps/api"].mode, "full");
    assert.ok(result["apps/api"].files.includes("src/a.ts"));
  }
});

test("baselines invalidate on environment and dependency changes, retaining native source/test reuse", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "llame-mutation-cache-"));
  const files = {
    "apps/api/package.json": JSON.stringify({
      dependencies: { "@workspace/runtime-safety": "workspace:*" },
    }),
    "apps/api/stryker.config.json": JSON.stringify({
      mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/excluded.ts"],
    }),
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
    "packages/config-typescript/package.json": "{}\n",
    "packages/config-typescript/base.json": "{}\n",
    "apps/web/app/page.tsx": "export const page = 1;\n",
    "repository-input.json": "{}\n",
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
    for (const file of [
      "apps/api/src/a.ts",
      "apps/api/src/a.test.ts",
      "apps/api/README.md",
      "apps/web/app/page.tsx",
    ]) {
      writeFileSync(path.join(directory, file), `${files[file]}// changed\n`);
      assert.equal(mutationFingerprint("apps/api", directory), baseline, file);
    }
    for (const file of [
      "apps/api/src/example.test-fixture.ts",
      "apps/api/src/excluded.ts",
      "apps/api/src/prompt.md",
      "packages/runtime-safety/src/index.ts",
      "packages/config-typescript/base.json",
      "repository-input.json",
    ]) {
      writeFileSync(path.join(directory, file), `${files[file]}changed\n`);
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

test("unknown inputs and root configuration expand all mutation workspaces", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "package.json",
    "scripts/mutation-scope.mjs",
    "new-runtime/input.txt",
  ]) {
    assert.deepEqual(
      Object.values(selectMutationScope([file], sources)).map(
        (scope) => scope.mode,
      ),
      ["full", "full", "full"],
    );
  }
});

test("known documentation and frontend changes need no mutation execution", () => {
  const result = selectMutationScope(
    [
      "README.md",
      "docs/testing.md",
      "openspec/specs/a/spec.md",
      ".agents/notes/local.md",
      "apps/api/README.md",
      "apps/web/app/page.tsx",
      "packages/ui/src/button.tsx",
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
