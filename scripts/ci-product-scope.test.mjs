import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

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
