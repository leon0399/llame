import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Registry guard. A rule can be written, tested, imported, and still never run,
// because registering it in the `rules` map is a separate edit that nothing
// checks. That happened once: an import landed while its map entry silently did
// not, and the rule reported nothing while looking installed.
const here = import.meta.dirname;
const source = readFileSync(join(here, "index.ts"), "utf8");

// Two trees: `rules/` is llame-authored, `vendor/` is upstream code kept as
// received. Both must be registered, so both are scanned. `stella-utils` is a
// shared helper module, not a rule.
const ruleFiles = ["rules", "vendor"]
  .flatMap((dir) =>
    readdirSync(join(here, dir)).filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        name !== "stella-utils.ts",
    ),
  )
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

process.stdout.write(
  `registry ok: ${ruleFiles.length} rules, all registered\n`,
);

// Load canary. The checks above prove the rules/ directory and the index map
// agree; they cannot prove the module actually loads. A duplicate import made
// oxlint fail plugin loading outright, which it reports as a config warning and
// then lints on with every anti-slop rule silently absent — so the whole suite
// read as "0 violations". Importing the plugin here turns that into a failure
// with a stack trace.
const loaded = (await import("./index.ts")).default;
const exported = Object.keys(loaded.rules ?? {});
assert.deepEqual(
  exported.toSorted(),
  ruleFiles.toSorted(),
  `the loaded plugin exposes different rules than rules/ holds: ${exported.join(", ")}`,
);
process.stdout.write(`plugin loads: ${exported.length} rules exposed\n`);
