import assert from "node:assert/strict";
import { test } from "node:test";

import {
  insertEntries,
  parseChangeset,
  selectChangesets,
} from "./compile-changelog.mjs";

const packages = new Set(["api", "web", "@workspace/ui"]);
const preamble = "_Reverse-chronological record of shipped work._";
const changelog = [
  preamble,
  "# 2026-11-26",
  "- Newest shipped.",
  "# 2026-11-20",
  "- Older shipped.",
].join("\n\n");

test("a changeset yields its entry and accepts quoted scoped packages", () => {
  const text =
    '---\n"api": minor\n"@workspace/ui": patch\n---\n\n- Ship it.\n  Wrapped.\n';

  assert.equal(
    parseChangeset("a.md", text, packages),
    "- Ship it.\n  Wrapped.",
  );
  assert.equal(
    parseChangeset("b.md", "---\n---\n\n- Chore.\n", packages),
    "- Chore.",
  );
});

test("a malformed changeset fails naming the file", () => {
  const cases = [
    ["- No frontmatter.\n", /missing --- frontmatter/],
    ["---\napi: huge\n---\n\n- X.\n", /not "<package>"/],
    ["---\nmobile: patch\n---\n\n- X.\n", /unknown package "mobile"/],
    ["---\napi: patch\n---\n\nProse, not a list item.\n", /list item/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parseChangeset("bad.md", text, packages), {
      message: new RegExp(`^\\.changeset/bad\\.md: .*${message.source}`),
    });
  }
});

test("entries go on top of their date, newest first", () => {
  const merged = insertEntries(changelog, [
    { name: "a.md", body: "- Earlier.", date: "2026-11-26", time: 1 },
    { name: "b.md", body: "- Later.", date: "2026-11-26", time: 2 },
  ]);

  assert.equal(
    merged,
    `${[preamble, "# 2026-11-26", "- Later.", "- Earlier.", "- Newest shipped.", "# 2026-11-20", "- Older shipped."].join("\n\n")}\n`,
  );
});

test("a new date is placed in date order, not at the top", () => {
  const merged = insertEntries(changelog, [
    { name: "a.md", body: "- Middle.", date: "2026-11-23", time: 1 },
    { name: "b.md", body: "- Oldest.", date: "2026-11-01", time: 2 },
  ]);

  assert.equal(
    merged,
    `${[preamble, "# 2026-11-26", "- Newest shipped.", "# 2026-11-23", "- Middle.", "# 2026-11-20", "- Older shipped.", "# 2026-11-01", "- Oldest."].join("\n\n")}\n`,
  );
});

test("a changeset of an active OpenSpec change is deferred", () => {
  const { ready, deferred } = selectChangesets(
    [
      { name: "tool-search.md" },
      { name: "tool-search.native.md" },
      { name: "tool-search-v2.md" },
      { name: "fix-composer.md" },
    ],
    new Set(["tool-search"]),
  );

  assert.deepEqual(
    deferred.map((changeset) => changeset.name),
    ["tool-search.md", "tool-search.native.md"],
  );
  assert.deepEqual(
    ready.map((changeset) => changeset.name),
    ["tool-search-v2.md", "fix-composer.md"],
  );
});
