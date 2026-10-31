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
 * The mutation rows cannot be rendered from the stored objects: a fixture edit
 * has no `display` and a fixture write has no `lineCount`, so both would render
 * the legacy forms. They call the live package on a temporary copy of the
 * fixture file instead, and the recorded locator is kept so the row stays
 * comparable to today's. The write row creates the fixture's content, so its
 * status names the resulting line count.
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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encode } from "gpt-tokenizer/encoding/o200k_base";

import {
  createFile,
  editFile,
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

/** The fixture file every case was recorded against, at the baseline commit. */
const FIXTURE_SOURCE = "apps/web/app/(chat)/components/chat-message-row.tsx";
const FIXTURE_REVISION = "64db12c9";

/** The text rendering of a read case: a read stores the line count its header
 *  names, which the recorded result does not carry. */
function readAfter(name, result) {
  if (!name.startsWith("read") || result === null) return undefined;
  return neutralizeReservedDelimiters(
    renderReadText({
      ...result,
      path: storedPath(result.path),
      lineCount: READ_LINE_COUNT,
    }),
  );
}

/** The text rendering of the mutation cases, measured from live package calls.
 *  A fixture edit carries no `display` and a fixture write no `lineCount`, so
 *  its stored object renders the legacy forms: the edit and the write run on a
 *  temporary copy of the fixture file instead. Each reports the recorded
 *  locator, so the row stays comparable to today's. */
async function measureMutations(cases) {
  const edit = cases.find((entry) => entry.case.startsWith("edit"));
  const write = cases.find((entry) => entry.case.startsWith("write"));
  if (edit === undefined || write === undefined) return new Map();
  const directory = mkdtempSync(join(tmpdir(), "tool-results-"));
  try {
    const source = join(directory, "chat-message-row.tsx");
    writeFileSync(
      source,
      execFileSync("git", ["show", `${FIXTURE_REVISION}:${FIXTURE_SOURCE}`], {
        encoding: "utf8",
      }),
    );
    const edited = await editFile(
      { path: source, oldText: edit.args.oldText, newText: edit.args.newText },
      undefined,
      { displayPath: storedPath(edit.args.path) },
    );
    const created = await createFile(
      { path: join(directory, "new.tsx"), content: write.args.content },
      undefined,
      { displayPath: write.args.path },
    );
    if (edited.status !== "success" || created.status !== "success")
      throw new Error("A mutation measured for the table failed.");
    return new Map([
      [edit.case, neutralizeReservedDelimiters(renderEditText(edited))],
      [write.case, neutralizeReservedDelimiters(renderWriteText(created))],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const cases = JSON.parse(readFileSync(FIXTURE, "utf8"));
const mutations = await measureMutations(cases);

const rows = cases.map(({ case: name, args, result, todayText }) => {
  const after = name.startsWith("read")
    ? readAfter(name, result)
    : mutations.get(name);
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
