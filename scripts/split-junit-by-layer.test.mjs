import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { layerOf, splitJunitByLayer } from "./split-junit-by-layer.mjs";

const report = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="4" failures="1" errors="0" time="1">
    <testsuite name="src/auth/auth.service.test.ts" tests="1" failures="0">
        <testcase classname="src/auth/auth.service.test.ts" name="hashes" time="0.1">
        </testcase>
    </testsuite>
    <testsuite name="src/auth/auth.integration.test.ts" tests="1" failures="1">
        <testcase classname="src/auth/auth.integration.test.ts" name="rejects a cross-tenant read" time="0.2">
            <failure message="expected 404">AssertionError</failure>
        </testcase>
    </testsuite>
    <testsuite name="components/chat-item.stories.tsx" tests="1" failures="0">
        <testcase classname="components/chat-item.stories.tsx" name="Default" time="0.3">
        </testcase>
    </testsuite>
    <testsuite name="src/empty.test.ts" tests="0" failures="0"/>
</testsuites>
`;

test("file names map to the layers the testing guide defines", () => {
  assert.equal(layerOf("src/runs/run-dispatch.service.test.ts"), "unit");
  assert.equal(layerOf("src/pins/pins-rls.integration.test.ts"), "integration");
  assert.equal(layerOf("components/chat-item.stories.tsx"), "component");
  assert.equal(layerOf("test/globals-css.test.ts"), "unit");
});

test("each suite lands in its layer's report, failures included", () => {
  const layers = splitJunitByLayer(report);

  assert.deepEqual([...layers.keys()].sort(), [
    "component",
    "integration",
    "unit",
  ]);
  assert.match(layers.get("integration"), /rejects a cross-tenant read/);
  assert.match(layers.get("integration"), /<failure message="expected 404">/);
  assert.doesNotMatch(layers.get("integration"), /hashes|Default/);
  assert.match(layers.get("unit"), /name="src\/empty\.test\.ts"/);
  assert.match(layers.get("component"), /name="Default"/);
});

test("the <testsuites> wrapper is never taken for a suite", () => {
  const unit = splitJunitByLayer(report).get("unit");

  assert.equal(unit.match(/<testsuites\b/g).length, 1);
  assert.doesNotMatch(unit, /vitest tests/);
});

test("a node:test report of bare testcases passes through as unit", () => {
  const nodeReport = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="merges entries" time="0.001" classname="test"/>
</testsuites>
`;
  const layers = splitJunitByLayer(nodeReport);

  assert.deepEqual([...layers.keys()], ["unit"]);
  assert.equal(layers.get("unit"), nodeReport);
});

test("a report without suites produces no layer files", () => {
  assert.equal(splitJunitByLayer('<testsuites name="vitest tests"/>').size, 0);
});

test("the command writes one file per layer present", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "split-junit-"));
  try {
    const input = path.join(dir, "junit.xml");
    writeFileSync(input, report);
    execFileSync(process.execPath, [
      "scripts/split-junit-by-layer.mjs",
      input,
      path.join(dir, "layers"),
    ]);

    assert.deepEqual(readdirSync(path.join(dir, "layers")).sort(), [
      "junit-component.xml",
      "junit-integration.xml",
      "junit-unit.xml",
    ]);
    assert.match(
      readFileSync(path.join(dir, "layers", "junit-unit.xml"), "utf8"),
      /auth\.service\.test\.ts/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
