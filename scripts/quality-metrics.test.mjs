import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeHalsteadFile, evaluateRows } from "./quality-metrics.mjs";

test("Halstead analysis returns callable-level rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "llame-quality-"));
  const file = path.join(directory, "nested.ts");
  await writeFile(
    file,
    `export function nested(first: boolean, second: boolean): number {
  if (first) {
    if (second) return 2;
  }
  return 0;
}\n`,
  );

  try {
    const rows = analyzeHalsteadFile(file);
    assert.equal(rows.length, 1);
    assert.match(rows[0].name, /nested\.ts nested$/u);
    assert.ok(rows[0].value > 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("Halstead analysis fails when the source file cannot be read", () => {
  assert.throws(
    () => analyzeHalsteadFile("/does/not/exist.ts"),
    /does not exist|ENOENT/u,
  );
});

test("a metric with no measured rows fails closed", () => {
  assert.throws(
    () => evaluateRows("Cognitive complexity", [], 25, {}),
    /measured zero functions/u,
  );
});

test("documented exceptions fail after becoming stale", () => {
  const result = evaluateRows(
    "Cognitive complexity",
    [{ name: "src/example.ts:1 example", file: "src/example.ts", value: 2 }],
    25,
    { "src/example.ts": "tracked exception" },
  );

  assert.equal(result.failures, 1);
  assert.deepEqual(result.stale, ["src/example.ts"]);
});
