/**
 * Splits a Vitest JUnit report into one report per test layer, so CI can
 * upload each to Codecov Test Analytics under its own layer flag.
 *
 * One Vitest run covers several layers of a workspace (unit and integration in
 * apps/api; unit and stories in apps/web and packages/ui), and its JUnit
 * reporter writes one `<testsuite>` per test file without the project name.
 * The layer is therefore read from the file name, following the naming rules
 * in docs/development/testing.md:
 *
 *   *.integration.test.*  -> integration
 *   *.stories.*           -> component
 *   anything else         -> unit
 *
 * Node's `node:test` JUnit reporter writes bare `<testcase>`s with no suite or
 * file name; such a report holds only the root scripts' unit tests and is
 * passed through whole as the unit layer.
 *
 * Usage: node scripts/split-junit-by-layer.mjs <report.xml> <output-dir>
 * Writes <output-dir>/junit-<layer>.xml for each layer the report contains.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// `\s` after the tag name keeps the `<testsuites>` wrapper out of the match.
const SUITE = /<testsuite\s[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g;
const SUITE_NAME = /^<testsuite\s[^>]*?\bname="([^"]*)"/;

export function layerOf(fileName) {
  if (/\.integration\.test\.[cm]?[jt]sx?$/.test(fileName)) return "integration";
  if (/\.stories\.[cm]?[jt]sx?$/.test(fileName)) return "component";
  return "unit";
}

/** Returns a map from layer to a standalone JUnit document for that layer. */
export function splitJunitByLayer(xml) {
  const suites = xml.match(SUITE) ?? [];
  if (suites.length === 0) {
    return new Map(/<testcase\b/.test(xml) ? [["unit", xml]] : []);
  }
  const suitesByLayer = new Map();
  for (const suite of suites) {
    const name = SUITE_NAME.exec(suite)?.[1] ?? "";
    const layer = layerOf(name);
    if (!suitesByLayer.has(layer)) suitesByLayer.set(layer, []);
    suitesByLayer.get(layer).push(suite);
  }
  return new Map(
    [...suitesByLayer].map(([layer, layerSuites]) => [
      layer,
      `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="${layer}">\n${layerSuites.join("\n")}\n</testsuites>\n`,
    ]),
  );
}

function main([reportPath, outputDir]) {
  if (!reportPath || !outputDir) {
    console.error(
      "usage: node scripts/split-junit-by-layer.mjs <report.xml> <output-dir>",
    );
    return 2;
  }
  mkdirSync(outputDir, { recursive: true });
  for (const [layer, document] of splitJunitByLayer(
    readFileSync(reportPath, "utf8"),
  )) {
    writeFileSync(path.join(outputDir, `junit-${layer}.xml`), document);
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
