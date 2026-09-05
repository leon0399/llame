#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import tsComplex from "ts-complex";
import ts from "typescript";

const THRESHOLDS = {
  halsteadDifficulty: 90,
};

const SOURCE_GLOBS = [
  "apps/api/src/**/*.ts",
  "apps/web/{app,lib,components,contexts,hooks,utils}/**/*.{ts,tsx}",
  "packages/ui/src/**/*.{ts,tsx}",
  "packages/config-interpolation/src/**/*.ts",
  "packages/runtime-safety/src/**/*.ts",
  "packages/tool-runtime/src/**/*.ts",
  "packages/knowledge-filesystem/src/**/*.ts",
  "packages/personal-node/src/**/*.ts",
  "apps/cli/src/**/*.ts",
  "apps/node/src/**/*.ts",
  "packages/node-client/src/**/*.ts",
  "packages/node-protocol/src/**/*.ts",
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

function relativeFile(file) {
  return path.relative(process.cwd(), file).replaceAll("\\", "/");
}

function sourceFiles() {
  return [...new Set(SOURCE_GLOBS.flatMap((pattern) => globSync(pattern)))]
    .filter((file) => !EXCLUDE.some((skip) => skip.test(file)))
    .sort();
}

function hasCallable(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function analyzeHalsteadFile(filePath) {
  const file = relativeFile(filePath);
  const source = readFileSync(filePath, "utf8");
  if (!hasCallable(source, file)) return [];

  let output;
  try {
    output = tsComplex.calculateHalstead(filePath);
  } catch (error) {
    throw new Error(`Halstead analysis failed for ${file}`, { cause: error });
  }

  return Object.entries(output).map(([name, metrics]) => {
    const difficulty = Number(metrics?.difficulty);
    return {
      file,
      name: `${file} ${name}`,
      value: Number.isFinite(difficulty) ? difficulty : 0,
    };
  });
}

export function evaluateRows(label, rows, threshold, exceptions) {
  if (rows.length === 0) {
    throw new Error(`${label} measured zero functions`);
  }

  const over = rows
    .filter((row) => row.value >= threshold)
    .sort((left, right) => right.value - left.value);
  const unexpected = over.filter((row) => !(row.file in exceptions));
  const stale = Object.keys(exceptions).filter(
    (file) => !over.some((row) => row.file === file),
  );
  return { failures: unexpected.length + stale.length, over, stale };
}

function printEvaluation(label, rows, threshold, exceptions) {
  const result = evaluateRows(label, rows, threshold, exceptions);
  console.log(`\n${label} (threshold < ${threshold})`);
  console.log(`  functions measured: ${rows.length}`);
  console.log(`  over threshold: ${result.over.length}`);
  for (const row of result.over) {
    const note = row.file in exceptions ? "  [documented exception]" : "";
    console.log(`    ${row.value.toFixed(1).padStart(7)}  ${row.name}${note}`);
  }
  for (const file of result.stale) {
    console.log(`  STALE EXCEPTION: ${file}`);
  }
  return result.failures;
}

function analyzeAll(analyze) {
  const files = sourceFiles();
  if (files.length === 0)
    throw new Error("Quality metrics matched zero source files");
  return files.flatMap(analyze);
}

function halstead() {
  return printEvaluation(
    "Halstead difficulty",
    analyzeAll(analyzeHalsteadFile),
    THRESHOLDS.halsteadDifficulty,
    {},
  );
}

const commands = { halstead };

function main() {
  const requested = process.argv[2] ?? "all";
  const selected =
    requested === "all" ? Object.keys(commands) : requested.split(",");
  let failures = 0;
  for (const name of selected) {
    const run = commands[name];
    if (!run) throw new Error(`Unknown metric: ${name}`);
    failures += run();
  }
  console.log(
    failures === 0
      ? "\nAll measured metrics within threshold."
      : `\n${failures} metric violation(s).`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
