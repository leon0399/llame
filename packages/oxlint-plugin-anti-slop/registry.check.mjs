import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Registry guard. A rule can be written, tested, imported, and still never run,
// because registering it in the `rules` map is a separate edit that nothing
// checks. That happened once: an import landed while its map entry silently did
// not, and the rule reported nothing while looking installed.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "index.ts"), "utf8");

const ruleFiles = readdirSync(join(here, "rules"))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => name.replace(/\.ts$/u, ""));

const registered = new Set(
  [...source.matchAll(/^\s{4}"([a-z0-9-]+)":/gmu)].map((match) => match[1]),
);

const missing = ruleFiles.filter((id) => !registered.has(id));
assert.deepEqual(
  missing,
  [],
  `rules/ has files with no entry in the index rules map: ${missing.join(", ")}`,
);

const orphaned = [...registered].filter((id) => !ruleFiles.includes(id));
assert.deepEqual(
  orphaned,
  [],
  `index registers rules with no file in rules/: ${orphaned.join(", ")}`,
);

console.log(`registry ok: ${ruleFiles.length} rules, all registered`);
