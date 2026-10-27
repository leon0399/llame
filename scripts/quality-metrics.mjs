#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SyntaxKind } from "typescript/ast";
import { isFunctionLikeDeclaration, isIdentifier } from "typescript/ast/is";
import { API } from "typescript/sync";

const THRESHOLDS = {
  halsteadDifficulty: 90,
};

const SOURCE_GLOBS = [
  "apps/api/src/**/*.ts",
  "apps/web/{app,lib,components,contexts,hooks,utils}/**/*.{ts,tsx}",
  "packages/ui/src/**/*.{ts,tsx}",
  "packages/config-interpolation/src/**/*.ts",
  "packages/runtime-safety/src/**/*.ts",
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

// One compiler API session for the whole run; it owns a native worker, so it
// is released on exit rather than per file.
const api = new API();
process.once("exit", () => api.close());

// Halstead counts over a function body (the definition ts-complex used, on
// the current compiler's syntax tree): every identifier or literal node is an
// operand, every punctuation or keyword token node is an operator, and
// uniqueness is by text (operands) or by token text, falling back to kind
// (operators).
function halsteadDifficulty(fn) {
  const operands = { total: 0, unique: new Set() };
  const operators = { total: 0, unique: new Set() };
  const visit = (node) => {
    const { kind } = node;
    if (
      kind === SyntaxKind.Identifier ||
      (kind >= SyntaxKind.FirstLiteralToken &&
        kind <= SyntaxKind.LastLiteralToken)
    ) {
      operands.total += 1;
      operands.unique.add(node.text);
    } else if (
      (kind >= SyntaxKind.FirstPunctuation &&
        kind <= SyntaxKind.LastPunctuation) ||
      (kind >= SyntaxKind.FirstKeyword && kind <= SyntaxKind.LastKeyword)
    ) {
      operators.total += 1;
      operators.unique.add(node.text ?? kind);
    }
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);

  const length = operands.total + operators.total;
  const vocabulary = operands.unique.size + operators.unique.size;
  if (length === 0 || vocabulary === 1 || operands.unique.size === 0) return 0;
  return (operators.unique.size / 2) * (operands.total / operands.unique.size);
}

export function analyzeHalsteadFile(filePath) {
  const file = relativeFile(filePath);
  const lease = api.createSourceFile(file, readFileSync(filePath, "utf8"));
  try {
    const rows = [];
    const visit = (node) => {
      if (isFunctionLikeDeclaration(node) && node.body !== undefined) {
        const name =
          node.name !== undefined && isIdentifier(node.name)
            ? node.name.text
            : JSON.stringify({ pos: node.pos, end: node.end });
        rows.push({
          file,
          name: `${file} ${name}`,
          value: halsteadDifficulty(node),
        });
      }
      node.forEachChild(visit);
    };
    visit(lease.sourceFile);
    return rows;
  } finally {
    lease.dispose();
  }
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
