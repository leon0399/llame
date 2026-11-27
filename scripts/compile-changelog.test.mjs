import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  insertEntries,
  parseChangeset,
  selectChangesets,
} from "./compile-changelog.mjs";

// A Git hook exports GIT_INDEX_FILE, GIT_DIR and friends; inheriting them would
// point the temp-repository commands below at the caller's repository.
for (const variable of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .trim()
  .split("\n"))
  delete process.env[variable];

const compiler = fileURLToPath(
  new URL("compile-changelog.mjs", import.meta.url),
);

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

function git(directory, ...args) {
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: directory,
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-11-24T12:00:00Z" },
  });
}

function write(directory, file, text) {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), text);
}

function repository() {
  const directory = mkdtempSync(path.join(tmpdir(), "compile-changelog-"));
  git(directory, "init", "-q", "--initial-branch=master");
  git(directory, "config", "user.name", "Changelog test");
  git(directory, "config", "user.email", "changelog@example.invalid");
  git(directory, "config", "core.autocrlf", "false");
  write(directory, "apps/api/package.json", '{ "name": "api" }\n');
  write(directory, "openspec/changes/active-change/proposal.md", "# P\n");
  write(directory, "openspec/changes/archive/shipped/proposal.md", "# P\n");
  write(directory, "CHANGELOG.md", `${changelog}\n`);
  write(directory, "packages/ui/package.json", '{ "name": "@workspace/ui" }\n');
  write(
    directory,
    ".changeset/fix.md",
    '---\napi: patch\n"@workspace/ui": patch\n---\n\n- Fix.\n',
  );
  write(
    directory,
    ".changeset/active-change.md",
    "---\napi: minor\n---\n\n- Partial feature.\n",
  );
  git(directory, "add", "-A");
  git(directory, "commit", "-qm", "base");
  return directory;
}

test("the command compiles committed changesets and keeps active changes", () => {
  const directory = repository();

  execFileSync("node", [compiler], { cwd: directory });

  assert.equal(
    readFileSync(path.join(directory, "CHANGELOG.md"), "utf8"),
    `${[preamble, "# 2026-11-26", "- Newest shipped.", "# 2026-11-24", "- Fix.", "# 2026-11-20", "- Older shipped."].join("\n\n")}\n`,
  );
  assert.equal(existsSync(path.join(directory, ".changeset/fix.md")), false);
  assert.equal(
    existsSync(path.join(directory, ".changeset/active-change.md")),
    true,
  );
});

test("the command refuses an uncommitted changeset and changes nothing", () => {
  const directory = repository();
  write(directory, ".changeset/new.md", "---\n---\n\n- Not merged.\n");

  const run = spawnSync("node", [compiler], {
    cwd: directory,
    encoding: "utf8",
  });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /\.changeset\/new\.md: commit it before compiling/);
  assert.equal(
    readFileSync(path.join(directory, "CHANGELOG.md"), "utf8"),
    `${changelog}\n`,
  );
  assert.equal(existsSync(path.join(directory, ".changeset/fix.md")), true);
});
