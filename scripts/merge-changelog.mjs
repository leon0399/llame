/**
 * Git merge driver for CHANGELOG.md, registered by the root `prepare` script
 * and selected by `.gitattributes`.
 *
 * Parallel pull requests each insert an entry at the top of the file, directly
 * under the same `# YYYY-MM-DD` heading or as the same new heading, so git's
 * line merge conflicts on nearly every day with two merges. When both sides
 * only added entries or date headings, the merge is resolved per date section:
 * the incoming side's entries go on top, which puts a rebased pull request's
 * entry above everything already on the target branch. Any other change falls
 * back to git's ordinary text merge, so edits to existing entries still
 * conflict visibly. GitHub's server-side merge never runs this driver.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HEADING = /^# (\d{4}-\d{2}-\d{2})$/;

/**
 * Splits the changelog into its preamble and date sections. Blocks separated
 * by blank lines are entries when they start with `- `; any other block is a
 * continuation paragraph of the entry above it.
 */
function parse(text) {
  const blocks = text.replace(/\n+$/, "").split(/\n[ \t]*\n/);
  const firstHeading = blocks.findIndex((block) => HEADING.test(block));
  if (firstHeading < 0) return null;
  const sections = new Map();
  let entries;
  for (const block of blocks.slice(firstHeading)) {
    const heading = HEADING.exec(block);
    if (heading) {
      if (sections.has(heading[1])) return null;
      entries = [];
      sections.set(heading[1], entries);
    } else if (block.startsWith("- ") || entries.length === 0) {
      entries.push(block);
    } else {
      entries[entries.length - 1] += `\n\n${block}`;
    }
  }
  return { preamble: blocks.slice(0, firstHeading).join("\n\n"), sections };
}

/** Entries a side added per date, or null when it did anything but add. */
function additions(base, side) {
  if (side.preamble !== base.preamble) return null;
  for (const [date, baseEntries] of base.sections) {
    const kept = (side.sections.get(date) ?? []).filter((entry) =>
      baseEntries.includes(entry),
    );
    if (kept.join("\0") !== baseEntries.join("\0")) return null;
  }
  const added = new Map();
  for (const [date, entries] of side.sections) {
    const baseEntries = base.sections.get(date) ?? [];
    const fresh = entries.filter((entry) => !baseEntries.includes(entry));
    if (fresh.length > 0) added.set(date, fresh);
  }
  return added;
}

/**
 * Merges two changelog revisions against their base, or returns null when a
 * side changed anything other than adding entries and date headings.
 */
export function mergeChangelog(baseText, oursText, theirsText) {
  const [base, ours, theirs] = [baseText, oursText, theirsText].map(parse);
  if (!base || !ours || !theirs) return null;
  const oursAdded = additions(base, ours);
  const theirsAdded = additions(base, theirs);
  if (!oursAdded || !theirsAdded) return null;

  const sections = new Map(base.sections);
  for (const date of new Set([...oursAdded.keys(), ...theirsAdded.keys()])) {
    const fromOurs = oursAdded.get(date) ?? [];
    const fromTheirs = (theirsAdded.get(date) ?? []).filter(
      (entry) => !fromOurs.includes(entry),
    );
    sections.set(date, [
      ...fromTheirs,
      ...fromOurs,
      ...(base.sections.get(date) ?? []),
    ]);
  }
  const body = [...sections.keys()]
    .sort()
    .reverse()
    .flatMap((date) => [`# ${date}`, ...sections.get(date)]);
  return `${[base.preamble, ...body].filter(Boolean).join("\n\n")}\n`;
}

/** Git invokes the driver as `%O %A %B %L`; the result replaces `%A`. */
function main([basePath, oursPath, theirsPath, markerSize = "7"]) {
  const merged = mergeChangelog(
    readFileSync(basePath, "utf8"),
    readFileSync(oursPath, "utf8"),
    readFileSync(theirsPath, "utf8"),
  );
  if (merged !== null) {
    writeFileSync(oursPath, merged);
    return 0;
  }
  const textMerge = spawnSync(
    "git",
    [
      "merge-file",
      `--marker-size=${markerSize}`,
      oursPath,
      basePath,
      theirsPath,
    ],
    { stdio: "inherit" },
  );
  return textMerge.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
