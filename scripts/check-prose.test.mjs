import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkText,
  documentsInScope,
  maxSentenceWords,
} from "./check-prose.mjs";

const messages = (text) =>
  checkText(text).map(({ line, message }) => `${line}: ${message}`);

const words = (count) =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(" ");

test("flags dashes, curly quotes, and semicolons in prose", () => {
  assert.deepEqual(
    messages("One \u2014 two.\n\nIt said \u201chi\u201d.\n\nA; b.\n"),
    [
      "1: dash used as punctuation",
      "3: curly quote",
      "5: semicolon in prose: write two sentences",
    ],
  );
});

test("ignores code, link targets, frontmatter, and tables", () => {
  const text = [
    "---",
    "status: a; b",
    "---",
    "",
    "Run `a; b` and see [the page](x.md#a;b).",
    "",
    "```sh",
    "a \u2014 b; c",
    "```",
    "",
    "| a; b | c \u2014 d |",
    "",
    "    indented; code",
  ].join("\n");
  assert.deepEqual(messages(text), []);
});

test("flags banned words with their inflections, whole words only", () => {
  assert.deepEqual(
    messages("We leveraged it. Enhancements help, fostering more.\n"),
    [
      '1: banned word "leveraged"',
      '1: banned word "Enhancements"',
      '1: banned word "fostering"',
    ],
  );
  assert.deepEqual(messages("A landscaper and an underscored_name.\n"), []);
});

test("counts a sentence across wrapped lines and reports its first line", () => {
  const all = words(maxSentenceWords + 1).split(" ");
  const [first, second] = [
    all.slice(0, 10).join(" "),
    `${all.slice(10).join(" ")}.`,
  ];
  assert.deepEqual(messages(`Short one.\n${first}\n${second}\n`), [
    `2: sentence of ${maxSentenceWords + 1} words: split it (limit ${maxSentenceWords})`,
  ]);
});

test("accepts a sentence at the limit and starts a new count per list item", () => {
  assert.deepEqual(messages(`${words(maxSentenceWords)}.\n`), []);
  const item = words(20);
  assert.deepEqual(messages(`- ${item}\n- ${item}\n`), []);
});

test("checks only tracked ADR documents and skips loader aliases", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "prose-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "docs/adr"), { recursive: true });
  writeFileSync(path.join(root, "docs/adr/AGENTS.md"), "Rules.\n");
  symlinkSync("AGENTS.md", path.join(root, "docs/adr/CLAUDE.md"));
  assert.deepEqual(
    documentsInScope(root, [
      "docs/adr/AGENTS.md",
      "docs/adr/CLAUDE.md",
      "docs/product/page.md",
    ]),
    ["docs/adr/AGENTS.md"],
  );
});
