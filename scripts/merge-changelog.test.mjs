import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeChangelog } from "./merge-changelog.mjs";

// A Git hook exports GIT_INDEX_FILE, GIT_DIR and friends; inheriting them would
// point the temp-repository commands below at the caller's repository.
for (const variable of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .trim()
  .split("\n"))
  delete process.env[variable];

const driver = fileURLToPath(new URL("merge-changelog.mjs", import.meta.url));
const preamble = "_Reverse-chronological record of shipped work._";

function changelog(...sections) {
  return `${[preamble, ...sections.flat()].join("\n\n")}\n`;
}

const shipped = [
  "# 2026-09-24",
  "- Shipped yesterday (#1).\n  Wrapped continuation line.",
  "Unindented continuation paragraph of #1.",
  "# 2026-09-23",
  "- Older entry (#0).",
];
const base = changelog(shipped);

test("two pull requests opening the same new day keep both entries", () => {
  const ours = changelog("# 2026-09-25", "- Ours (#2).", shipped);
  const theirs = changelog("# 2026-09-25", "- Theirs (#3).", shipped);

  assert.equal(
    mergeChangelog(base, ours, theirs),
    changelog("# 2026-09-25", "- Theirs (#3).", "- Ours (#2).", shipped),
  );
});

test("entries added under an existing day go above that day's entries", () => {
  const [heading, ...rest] = shipped;
  const ours = changelog(heading, "- Ours (#2).", rest);
  const theirs = changelog(heading, "- Theirs (#3).", rest);

  assert.equal(
    mergeChangelog(base, ours, theirs),
    changelog(heading, "- Theirs (#3).", "- Ours (#2).", rest),
  );
});

test("an entry both sides added identically is kept once", () => {
  const side = changelog("# 2026-09-25", "- Same (#2).", shipped);

  assert.equal(mergeChangelog(base, side, side), side);
});

test("a changed existing entry leaves the merge to git", () => {
  const edited = base.replace("Older entry", "Reworded older entry");
  const added = changelog("# 2026-09-25", "- Theirs (#3).", shipped);

  assert.equal(mergeChangelog(base, edited, added), null);
  assert.equal(mergeChangelog(base, added, edited), null);
});

test("a removed entry or changed preamble leaves the merge to git", () => {
  const removed = changelog(shipped.slice(0, 3));
  const retitled = base.replace(preamble, "_Changelog._");

  assert.equal(mergeChangelog(base, removed, base), null);
  assert.equal(mergeChangelog(base, base, retitled), null);
});

function git(directory, ...arguments_) {
  return spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...arguments_], {
    cwd: directory,
    encoding: "utf8",
  });
}

function commit(directory, content, message) {
  writeFileSync(path.join(directory, "CHANGELOG.md"), content);
  git(directory, "commit", "-qam", message);
}

function repository() {
  const directory = mkdtempSync(path.join(tmpdir(), "merge-changelog-"));
  git(directory, "init", "-q", "--initial-branch=master");
  git(directory, "config", "user.name", "Merge driver test");
  git(directory, "config", "user.email", "merge-driver@example.invalid");
  // The host's global core.autocrlf would otherwise check files out as CRLF;
  // this repository pins LF through its own .gitattributes.
  git(directory, "config", "core.autocrlf", "false");
  git(
    directory,
    "config",
    "merge.changelog.driver",
    `node ${driver} %O %A %B %L`,
  );
  writeFileSync(
    path.join(directory, ".gitattributes"),
    "CHANGELOG.md merge=changelog\n",
  );
  writeFileSync(path.join(directory, "CHANGELOG.md"), base);
  git(directory, "add", "-A");
  git(directory, "commit", "-qm", "base");
  return directory;
}

/** A repository where `feature` and `master` each opened 2026-09-25. */
function divergedRepository() {
  const directory = repository();
  git(directory, "switch", "-qc", "feature");
  commit(
    directory,
    changelog("# 2026-09-25", "- Feature (#3).", shipped),
    "feature",
  );
  git(directory, "switch", "-q", "master");
  commit(
    directory,
    changelog("# 2026-09-25", "- Landed (#2).", shipped),
    "landed",
  );
  return directory;
}

const featureOnTop = changelog(
  "# 2026-09-25",
  "- Feature (#3).",
  "- Landed (#2).",
  shipped,
);

test("git runs the driver on rebase and puts the rebased entry on top", () => {
  const directory = divergedRepository();
  git(directory, "switch", "-q", "feature");

  const rebase = git(directory, "rebase", "master");

  assert.equal(rebase.status, 0, rebase.stderr);
  assert.equal(
    readFileSync(path.join(directory, "CHANGELOG.md"), "utf8"),
    featureOnTop,
  );
});

test("git runs the driver on merge and puts the merged branch's entry on top", () => {
  const directory = divergedRepository();

  const merge = git(directory, "merge", "-q", "--no-edit", "feature");

  assert.equal(merge.status, 0, merge.stderr);
  assert.equal(
    readFileSync(path.join(directory, "CHANGELOG.md"), "utf8"),
    featureOnTop,
  );
});

test("git still reports a conflict when both sides edit the same entry", () => {
  const directory = repository();
  git(directory, "switch", "-qc", "feature");
  commit(directory, base.replace("Older entry", "Feature wording"), "feature");
  git(directory, "switch", "-q", "master");
  commit(directory, base.replace("Older entry", "Landed wording"), "landed");

  const merge = git(directory, "merge", "-q", "feature");

  assert.notEqual(merge.status, 0);
  const merged = readFileSync(path.join(directory, "CHANGELOG.md"), "utf8");
  assert.match(merged, /^<{7} /m);
  assert.match(merged, /Feature wording/);
  assert.match(merged, /Landed wording/);
});
