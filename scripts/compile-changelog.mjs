/**
 * Moves shipped `.changeset/*.md` entries into CHANGELOG.md and deletes them.
 *
 * Pull requests never edit CHANGELOG.md: each one adds or amends a file under
 * `.changeset/`, so parallel work never touches the same file. A changeset
 * whose name, up to the first dot, is an active OpenSpec change stays in place
 * until that change is archived, so a feature merged layer by layer gets one
 * entry dated by its last layer.
 *
 * Run `pnpm changelog:compile` on a branch from master and commit the result.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HEADING = /^# (\d{4}-\d{2}-\d{2})$/;
const FRONTMATTER = /^---\n([\s\S]*?)^---\n([\s\S]*)$/m;
const RELEASE = /^\s*"?([^":\s][^":]*?)"?\s*:\s*(major|minor|patch)\s*$/;

/** Validates one changeset file and returns its entry text. */
export function parseChangeset(name, text, packageNames) {
  const match = FRONTMATTER.exec(text);
  if (!match || match.index !== 0) {
    throw new Error(`.changeset/${name}: missing --- frontmatter`);
  }
  for (const line of match[1].split("\n").filter((l) => l.trim())) {
    const release = RELEASE.exec(line);
    if (!release) {
      throw new Error(
        `.changeset/${name}: "${line}" is not "<package>": major|minor|patch`,
      );
    }
    if (!packageNames.has(release[1])) {
      throw new Error(`.changeset/${name}: unknown package "${release[1]}"`);
    }
  }
  const body = match[2].trim();
  if (!body.startsWith("- ")) {
    throw new Error(`.changeset/${name}: the entry must be a "- " list item`);
  }
  return body;
}

/** The change name a changeset belongs to: its file stem up to the first dot. */
function changeOf(name) {
  return name.replace(/\.md$/, "").split(".")[0];
}

/**
 * A changeset sits one directory below the root, so its relative links start
 * with `../`; drop that prefix so they resolve from CHANGELOG.md.
 */
function rootRelativeLinks(body) {
  return body.replace(/(\]\(<?|^ *\[[^\]\n]+\]: *<?)\.\.\//gm, "$1");
}

/**
 * Inserts entries into the changelog text. Each entry is `{ name, body, date,
 * time }`; entries of one date go on top of that date's section, newest first.
 */
export function insertEntries(changelog, entries) {
  const blocks = changelog.replace(/\n+$/, "").split(/\n[ \t]*\n/);
  const byDate = Map.groupBy(
    entries.toSorted((a, b) => b.time - a.time),
    (entry) => entry.date,
  );
  for (const [date, dated] of byDate) {
    const bodies = dated.map((entry) => rootRelativeLinks(entry.body));
    const existing = blocks.findIndex((block) => block === `# ${date}`);
    if (existing >= 0) {
      blocks.splice(existing + 1, 0, ...bodies);
      continue;
    }
    const older = blocks.findIndex((block) => {
      const heading = HEADING.exec(block);
      return heading !== null && heading[1] < date;
    });
    blocks.splice(older < 0 ? blocks.length : older, 0, `# ${date}`, ...bodies);
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Splits changesets into those to compile now and those deferred because
 * their OpenSpec change is still active.
 */
export function selectChangesets(changesets, activeChanges) {
  const ready = [];
  const deferred = [];
  for (const changeset of changesets) {
    (activeChanges.has(changeOf(changeset.name)) ? deferred : ready).push(
      changeset,
    );
  }
  return { ready, deferred };
}

function workspacePackageNames(root) {
  const names = new Set();
  for (const group of ["apps", "packages"]) {
    for (const dir of readdirSync(path.join(root, group))) {
      const manifest = path.join(root, group, dir, "package.json");
      if (existsSync(manifest)) {
        names.add(JSON.parse(readFileSync(manifest, "utf8")).name);
      }
    }
  }
  return names;
}

function activeChangeNames(root) {
  const changes = path.join(root, "openspec", "changes");
  return new Set(
    readdirSync(changes, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "archive")
      .map((entry) => entry.name),
  );
}

/**
 * The date and time of the last commit that touched the file, which must
 * match the working tree: an uncommitted edit has no merge date.
 */
function lastCommit(root, file) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const stamp = git("log", "-1", "--format=%cs %ct", "--", file);
  if (!stamp || git("status", "--porcelain", "--", file)) {
    throw new Error(`${file}: commit it before compiling`);
  }
  const [date, time] = stamp.split(" ");
  return { date, time: Number(time) };
}

function main(root) {
  const dir = path.join(root, ".changeset");
  const names = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(".md"))
    : [];
  const packageNames = workspacePackageNames(root);
  const changesets = names.map((name) => ({
    name,
    body: parseChangeset(
      name,
      readFileSync(path.join(dir, name), "utf8"),
      packageNames,
    ),
  }));
  const { ready, deferred } = selectChangesets(
    changesets,
    activeChangeNames(root),
  );
  for (const { name } of deferred) {
    console.log(`deferred .changeset/${name}: its OpenSpec change is active`);
  }
  if (ready.length === 0) return;

  const entries = ready.map((changeset) => ({
    ...changeset,
    ...lastCommit(root, path.join(".changeset", changeset.name)),
  }));
  const changelogPath = path.join(root, "CHANGELOG.md");
  writeFileSync(
    changelogPath,
    insertEntries(readFileSync(changelogPath, "utf8"), entries),
  );
  for (const { name } of ready) {
    unlinkSync(path.join(dir, name));
    console.log(`compiled .changeset/${name}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.cwd());
}
