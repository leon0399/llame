#!/usr/bin/env node

/**
 * Prints the model-facing tool-result measurement table.
 *
 * The "today" columns are the `64db12c9` baseline captured once from that
 * worktree's built packages: the committed fixture holds each case's result
 * object and the exact text the old serializer produced for it, so the numbers
 * never drift. The "after" columns render the same stored objects through the
 * text renderer this change adds, with the shown window held equal to today's —
 * the bound-limited read stays the window the JSON bound left it, so its
 * "after" adds the continuation line instead of refilling to the text bound.
 *
 * A case whose renderer lands in a later layer shows `—` in the after columns.
 *
 * Two differences from the proposal's table are expected and explained by later
 * decisions rather than by drift: the read header's ` of <total> lines` and the
 * continuation line's stored requested end were both chosen after that table
 * was measured, so the bound-limited row resumes to `:387-2000` instead of the
 * file's last line and costs one token more.
 *
 * Run: `pnpm --filter @workspace/native-file-tools build && node
 * scripts/measure-tool-results.mjs`
 */

import { readFileSync } from "node:fs";

import { encode } from "gpt-tokenizer/encoding/o200k_base";

import {
  renderEditText,
  renderReadText,
  renderWriteText,
} from "../packages/native-file-tools/dist/index.js";
import { neutralizeReservedDelimiters } from "../packages/runtime-safety/dist/index.js";

const FIXTURE = new URL("./fixtures/tool-results/today.json", import.meta.url);

/** The fixture source's line count at `64db12c9`. A text read stores it, and
 *  its header names the total. */
const READ_LINE_COUNT = 562;

/** The stored display path of a read case. The fixture records the submitted
 *  locator, whose selector the tool splits off before it stores `path`, so a
 *  header built from it would repeat the selector. */
const storedPath = (locator) =>
  locator.replace(/:(?:raw:|outline:)?[\d,-]+$/u, "");

const tokens = (text) => encode(text).length;

/** The text rendering of a case a text renderer covers. Read and edit successes
 *  carry the line count their header names. */
function afterText(name, result) {
  if (result === null) return undefined;
  if (name.startsWith("read")) {
    return neutralizeReservedDelimiters(
      renderReadText({
        ...result,
        path: storedPath(result.path),
        lineCount: READ_LINE_COUNT,
      }),
    );
  }
  if (name.startsWith("edit")) {
    const stored = {
      ...result,
      path: storedPath(result.path),
      lineCount: READ_LINE_COUNT + 1,
    };
    return neutralizeReservedDelimiters(renderEditText(stored));
  }
  if (name.startsWith("write")) {
    return neutralizeReservedDelimiters(renderWriteText(result));
  }
  return undefined;
}

const cases = JSON.parse(readFileSync(FIXTURE, "utf8"));

const rows = cases.map(({ case: name, args, result, todayText }) => {
  const after = afterText(name, result);
  return {
    name,
    args: tokens(JSON.stringify(args)),
    chars: todayText.length,
    today: tokens(todayText),
    afterChars: after === undefined ? undefined : after.length,
    after: after === undefined ? undefined : tokens(after),
  };
});

const num = (count) => count.toLocaleString("en-US");

const cell = (value) => (value === undefined ? "—" : num(value));

const change = (row) =>
  row.after === undefined
    ? "—"
    : `\u2212${String(Math.round((1 - row.after / row.today) * 100))}%`;

const lines = [
  "| Case | Args tokens | Today chars | Today tokens | After chars | After tokens | Change |",
  "| --- | --: | --: | --: | --: | --: | --: |",
  ...rows.map(
    (row) =>
      `| ${row.name} | ${num(row.args)} | ${num(row.chars)} | ${num(row.today)} | ${cell(row.afterChars)} | ${cell(row.after)} | ${change(row)} |`,
  ),
];

process.stdout.write(`${lines.join("\n")}\n`);
