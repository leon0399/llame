#!/usr/bin/env node

/**
 * Prints the model-facing tool-result measurement table.
 *
 * The "today" column is the `64db12c9` baseline captured once from that
 * worktree's built packages: the committed fixture holds each case's result
 * object and the exact text the old serializer produced for it, so the numbers
 * never drift with later layers. The "after" columns wait for the renderers:
 * each layer that lands one fills its rows from the live renderer.
 *
 * Run: `node scripts/measure-tool-results.mjs`
 */

import { readFileSync } from "node:fs";

import { encode } from "gpt-tokenizer/encoding/o200k_base";

const FIXTURE = new URL("./fixtures/tool-results/today.json", import.meta.url);

const tokens = (text) => encode(text).length;

const cases = JSON.parse(readFileSync(FIXTURE, "utf8"));

const rows = cases.map(({ case: name, args, todayText }) => ({
  name,
  args: tokens(JSON.stringify(args)),
  chars: todayText.length,
  today: tokens(todayText),
}));

const num = (count) => count.toLocaleString("en-US");

const lines = [
  "| Case | Args tokens | Today chars | Today tokens | After chars | After tokens |",
  "| --- | --: | --: | --: | --: | --: |",
  ...rows.map(
    (row) =>
      `| ${row.name} | ${num(row.args)} | ${num(row.chars)} | ${num(row.today)} | — | — |`,
  ),
];

process.stdout.write(`${lines.join("\n")}\n`);
