#!/usr/bin/env node
/**
 * Enforce the suffix-is-runner naming contract (docs/testing.md):
 *
 *   *.test.ts(x)  — Vitest, anywhere except the root e2e/ tree
 *   *.spec.ts     — Playwright, ONLY under the root e2e/ tree
 *
 * This guard exists because every runner discovers files by include glob — a
 * misnamed file is not an error to the runner, it is simply never run, which
 * reads as coverage that does not exist. Runs from CI (checks job) and the
 * lefthook pre-commit hook; it is a plain root script, not a turbo task, so
 * no per-package input hashing can ever replay a stale pass.
 */
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n");

const violations = [];
for (const file of files) {
  const inRootE2e = file.startsWith("e2e/");
  if (/\.e2e-spec\.[cm]?[jt]sx?$/.test(file)) {
    violations.push(
      `${file}: ".e2e-spec" naming is dead — use <app>/e2e/*.test.ts`,
    );
  } else if (/\.spec\.[cm]?[jt]sx?$/.test(file) && !inRootE2e) {
    violations.push(
      `${file}: ".spec" is reserved for Playwright under e2e/ — Vitest files are *.test.ts(x)`,
    );
  } else if (/\.test\.[cm]?[jt]sx?$/.test(file) && inRootE2e) {
    violations.push(
      `${file}: root e2e/ is Playwright-only — name product e2e specs *.spec.ts`,
    );
  }
}

if (violations.length > 0) {
  console.error("Test naming violations (see docs/testing.md):\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`test naming OK (${files.length} tracked files checked)`);
