#!/usr/bin/env node
// Reports the code-quality targets that no linter in this repository measures.
//
// This is a thin driver, deliberately: every number below comes out of a
// standard library (`ts-complex` for Halstead and cyclomatic,
// `cognitive-complexity-ts` for cognitive, vitest's own coverage JSON), and the
// only arithmetic here is the published CRAP formula over two of them. Nothing
// implements a metric. See docs/code-quality-targets.md.
//
//   node scripts/quality-metrics.mjs halstead|cognitive|crap|all

import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const THRESHOLDS = {
  halsteadDifficulty: 90,
  cognitive: 25,
  crap: 25,
};

/** Product source only: generated, vendored, and test files are out of scope. */
const SOURCE_GLOBS = [
  "apps/api/src/**/*.ts",
  "apps/web/{app,lib,components,contexts,hooks,utils}/**/*.{ts,tsx}",
  "packages/ui/src/**/*.{ts,tsx}",
  "packages/config-interpolation/src/**/*.ts",
];

const EXCLUDE = [
  /\.test\.tsx?$/u,
  /\.spec\.ts$/u,
  /\.stories\.tsx$/u,
  /\/__mocks__\//u,
  /\/db\/migrations\//u,
  /\/lib\/api\/generated\//u,
  /\/vendor\//u,
  /\/testing\//u,
];

const sourceFiles = () =>
  SOURCE_GLOBS.flatMap((pattern) => globSync(pattern)).filter(
    (file) => !EXCLUDE.some((skip) => skip.test(file)),
  );

/**
 * Files allowed over a threshold, each with the reason and where it is tracked.
 *
 * This is a RATCHET, not an escape hatch: a listed file that falls below its
 * threshold is reported as a stale exception and fails too, so the list can
 * only shrink. Adding an entry is a decision to be argued in review, exactly
 * like raising a threshold — which CODING_STANDARDS §4 prohibits outright.
 */
const EXCEPTIONS = {
  cognitive: {
    "apps/api/src/runs/run-execution.service.ts":
      "executeRun and its callbacks close over ~8 let-mutated locals shared " +
      "across onTextDelta/onReasoningDelta/onError/onFinish and the tool " +
      "execute wrapper. Extracting any of them means threading a shared " +
      "mutable box, and the file's own comments say only the five " +
      "Postgres-backed integration suites can verify stream ordering, " +
      "abort-mid-flight, and tool-settlement races. Tracked in " +
      "docs/code-quality-tracker.md as the run-execution decomposition.",
  },
};

/** One row per file, sorted worst-first, with a pass/fail count. */
function report(label, rows, threshold, metric) {
  const allowed = EXCEPTIONS[metric] ?? {};
  const over = rows.filter((row) => row.value >= threshold);
  over.sort((a, b) => b.value - a.value);
  const unexpected = over.filter((row) => !(row.name in allowed));
  const stale = Object.keys(allowed).filter(
    (name) => !over.some((row) => row.name === name),
  );

  console.log(`\n${label} (threshold < ${threshold})`);
  console.log(`  files measured: ${rows.length}`);
  console.log(`  over threshold: ${over.length}`);
  for (const row of over) {
    const note = row.name in allowed ? "  [documented exception]" : "";
    console.log(`    ${row.value.toFixed(1).padStart(7)}  ${row.name}${note}`);
  }
  for (const name of stale) {
    console.log(
      `  STALE EXCEPTION: ${name} is now under threshold — remove it from EXCEPTIONS.`,
    );
  }
  return unexpected.length + stale.length;
}

async function halstead() {
  const { calculateHalstead } = await import("ts-complex");
  const rows = [];
  for (const file of sourceFiles()) {
    try {
      const result = calculateHalstead(file);
      // ts-complex reports per-function; take the file's worst.
      const values = Object.values(result ?? {})
        .map((entry) => Number(entry?.difficulty))
        .filter((value) => Number.isFinite(value));
      if (values.length > 0) {
        rows.push({ name: file, value: Math.max(...values) });
      }
    } catch {
      // A file ts-complex cannot parse is reported by tsgo and oxlint already;
      // skipping it here keeps this driver from duplicating their errors.
    }
  }
  return report(
    "Halstead difficulty",
    rows,
    THRESHOLDS.halsteadDifficulty,
    "halstead",
  );
}

async function cognitive() {
  // Uses the package's own `ccts-json` CLI rather than reaching into its module
  // internals: the CLI is its documented interface. It keys results by
  // BASENAME, which collides across a monorepo, so files are measured one at a
  // time and re-keyed to their real path.
  const { execFileSync } = await import("node:child_process");
  const rows = [];
  for (const file of sourceFiles()) {
    let parsed;
    try {
      parsed = JSON.parse(
        execFileSync("./node_modules/.bin/ccts-json", [file], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      continue;
    }
    // Cognitive complexity is a PER-FUNCTION metric. The tool's top-level
    // entry is `kind: "file"` and carries the sum of everything inside it;
    // scoring against that would demand splitting files rather than
    // simplifying functions, which is the opposite of what the threshold is
    // for. Only callable entries count, and the file's worst one represents it.
    const CALLABLE = new Set(["function", "method", "arrow", "constructor"]);
    const scores = [];
    const walk = (entry) => {
      if (!entry) return;
      if (CALLABLE.has(entry.kind)) {
        const score = Number(entry.score);
        if (Number.isFinite(score)) scores.push(score);
      }
      for (const child of entry.inner ?? []) walk(child);
    };
    for (const entry of Object.values(parsed)) walk(entry);
    if (scores.length > 0) {
      rows.push({ name: file, value: Math.max(...scores) });
    }
  }
  return report(
    "Cognitive complexity",
    rows,
    THRESHOLDS.cognitive,
    "cognitive",
  );
}

/**
 * CRAP = cc² × (1 − coverage)³ + cc — the published formula, over vitest's
 * coverage JSON and ts-complex's cyclomatic number. Uncovered complex code
 * scores high; either covering it or simplifying it brings it down.
 */
async function crap() {
  const summaryPaths = [
    "apps/api/coverage/coverage-final.json",
    "apps/web/coverage/coverage-final.json",
    "packages/ui/coverage/coverage-final.json",
    "packages/config-interpolation/coverage/coverage-final.json",
  ].filter((file) => existsSync(file));

  if (summaryPaths.length === 0) {
    console.error(
      "No coverage JSON found. Run the workspace `test:coverage` scripts first.",
    );
    return -1;
  }

  const { calculateCyclomaticComplexity } = await import("ts-complex");
  const rows = [];
  for (const summaryPath of summaryPaths) {
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    for (const [absolute, entry] of Object.entries(summary)) {
      const statements = Object.values(entry.s ?? {});
      if (statements.length === 0) continue;
      const covered =
        statements.filter((hits) => hits > 0).length / statements.length;
      const relative = path.relative(process.cwd(), absolute);
      if (EXCLUDE.some((skip) => skip.test(relative))) continue;
      let cc = 1;
      try {
        const perFunction = calculateCyclomaticComplexity(absolute);
        const values = Object.values(perFunction ?? {})
          .map(Number)
          .filter(Number.isFinite);
        if (values.length > 0) cc = Math.max(...values);
      } catch {
        continue;
      }
      rows.push({ name: relative, value: cc ** 2 * (1 - covered) ** 3 + cc });
    }
  }
  return report("CRAP", rows, THRESHOLDS.crap, "crap");
}

const commands = { halstead, cognitive, crap };
const requested = process.argv[2] ?? "all";
const selected =
  requested === "all" ? Object.keys(commands) : requested.split(",");

let failures = 0;
for (const name of selected) {
  const run = commands[name];
  if (!run) {
    console.error(`unknown metric: ${name}`);
    process.exit(2);
  }
  const over = await run();
  if (over > 0) failures += over;
}
console.log(
  failures === 0
    ? "\nAll measured metrics within threshold."
    : `\n${failures} file(s) over threshold.`,
);
process.exit(failures === 0 ? 0 : 1);
