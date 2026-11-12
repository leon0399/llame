import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import { needsProductChecks } from "./ci-product-scope.mjs";

const documentation = [
  "README.md",
  "CHANGELOG.md",
  "docs/research/harnesses/example.md",
  "docs/research/evidence/results.json",
  "openspec/specs/tool-calling/spec.md",
  "openspec/changes/tool-search/.openspec.yaml",
  "openspec/changes/archive/2026-11-12-example/tasks.md",
  ".agents/skills/example/SKILL.md",
  ".claude/skills/example",
  "apps/api/AGENTS.md",
  "apps/api/README.md",
  "packages/ui/CHANGELOG.md",
  ".github/pull_request_template.md",
];

test("documentation, evidence, proposals and archives need no product checks", () => {
  assert.equal(needsProductChecks(documentation), false);
  assert.equal(needsProductChecks([]), false);
});

test("runtime prompts and unknown paths keep the product gate enabled", () => {
  for (const file of [
    "apps/api/src/prompts/tools/read.md",
    "apps/web/app/page.tsx",
    "packages/ui/src/components/button.tsx",
    "pnpm-lock.yaml",
    "package.json",
    "turbo.json",
    ".github/workflows/ci.yml",
    "docker/api/Dockerfile",
    "scripts/ci-product-scope.mjs",
    "new-runtime/input.md",
  ]) {
    assert.equal(needsProductChecks([...documentation, file]), true, file);
  }
});

test("CLI preserves NUL-delimited filenames and reports a job output", () => {
  const result = spawnSync(process.execPath, ["scripts/ci-product-scope.mjs"], {
    input:
      "docs/evidence/file with spaces.json\0docs/evidence/line\nbreak.txt\0",
    encoding: "utf8",
    cwd: new URL("..", import.meta.url),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "product=false\n");
});

test("the scope step rejects empty or malformed detector output", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ci-product-scope-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = parseYaml(
    readFileSync(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );

  const step = workflow.jobs.changes.steps.find(({ id }) => id === "scope");
  writeFileSync(path.join(directory, "git"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  writeFileSync(
    path.join(directory, "node"),
    '#!/bin/sh\nprintf "%s" "$DETECTOR_OUTPUT"\n',
    {
      mode: 0o755,
    },
  );

  for (const [name, output] of [
    ["empty", ""],
    ["malformed", "product=unknown\n"],
  ]) {
    const outputFile = path.join(directory, `${name}.output`);

    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        EVENT: "pull_request",
        GITHUB_OUTPUT: outputFile,
        DETECTOR_OUTPUT: output,
      },
    });

    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.equal(existsSync(outputFile), false, name);
  }
});
