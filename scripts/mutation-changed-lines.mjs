/**
 * The pull-request mutation gate: mutate the lines a diff changed, and require
 * them to be detected.
 *
 * A delta gate needs a stored index, a cache key for it and a fingerprint for
 * that key, and only a trusted run writes an index — so a pull request whose
 * tree differs from the measured revision cannot restore one. Stryker answers
 * the same question directly: a *mutation range* mutates only the code blocks a
 * diff touched, and `coverageAnalysis` runs only the tests covering each
 * mutant. Both are already available, so the gate needs no stored state and
 * cannot go stale.
 *
 * `docs/mutation-gate-redesign.md` records why this replaced the per-file
 * delta.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mutationSourceFiles, mutationWorkspaces } from "./mutation-scope.mjs";
import { mergeMutationReports } from "./mutation-sharding.mjs";

/** Ranges closer than this merge, so a hunk-per-line diff stays one argument. */
const coalesceGap = 3;

/** A file with more ranges than this falls back to the whole file. */
const maxRangesPerFile = 8;

function git(arguments_, cwd) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseHunks(diff) {
  const ranges = new Map();
  let file;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      file = target === "/dev/null" ? undefined : target.replace(/^b\//u, "");
      continue;
    }
    if (file === undefined) continue;
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (match === null) continue;
    const start = Number(match[1]);
    // A hunk that only deletes lines has no range on the new side.
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;
    const existing = ranges.get(file) ?? [];
    existing.push([start, start + count - 1]);
    ranges.set(file, existing);
  }
  return ranges;
}

function coalesce(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] - last[1] <= coalesceGap + 1)
      last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * The mutation ranges a diff introduced, per workspace-relative file.
 *
 * Only mutant sources are kept: a range in a test, a fixture, a migration or a
 * configuration file names no mutant, so it has nothing to contribute.
 */
export function changedLineRanges(base, root = process.cwd()) {
  const revision = git(["merge-base", "HEAD", base], root).trim();
  const diff = git(
    ["diff", "--unified=0", "--no-renames", revision, "--"],
    root,
  );
  const hunks = parseHunks(diff);

  const byWorkspace = {};
  for (const workspace of mutationWorkspaces) {
    const mutable = new Set(mutationSourceFiles(path.join(root, workspace)));
    const entries = [];
    for (const [file, ranges] of hunks) {
      if (!file.startsWith(`${workspace}/`)) continue;
      const relative = file.slice(workspace.length + 1);
      if (!mutable.has(relative)) continue;
      entries.push({ file: relative, ranges: coalesce(ranges) });
    }
    entries.sort((left, right) => left.file.localeCompare(right.file));
    byWorkspace[workspace] = entries;
  }
  return byWorkspace;
}

/** The `--mutate` argument value for one workspace, or undefined when inert. */
export function mutateArgument(entries) {
  const parts = [];
  for (const { file, ranges } of entries) {
    if (ranges.length === 0 || ranges.length > maxRangesPerFile)
      parts.push(file);
    else
      for (const [start, end] of ranges) parts.push(`${file}:${start}-${end}`);
  }
  return parts.length === 0 ? undefined : parts.join(",");
}

function main(arguments_) {
  const [command] = arguments_;
  if (command === "plan") {
    const base = arguments_[arguments_.indexOf("--base") + 1];
    if (!base) throw new Error("plan requires --base <ref>");
    const ranges = changedLineRanges(base);
    const result = Object.fromEntries(
      mutationWorkspaces.map((workspace) => [
        workspace,
        mutateArgument(ranges[workspace]) ?? null,
      ]),
    );
    console.log(JSON.stringify(result));
    return;
  }
  if (command === "gate") {
    const reportFile = arguments_[1];
    if (!reportFile) throw new Error("gate requires a report file");
    const index = arguments_.indexOf("--threshold");
    const threshold = index === -1 ? 80 : Number(arguments_[index + 1]);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    const { score, counts } = mergeMutationReports([report]);
    console.log(
      `mutation score ${score.toFixed(2)}% over ${Object.values(counts).reduce((total, count) => total + count, 0)} mutants ` +
        `(${Object.entries(counts)
          .filter(([, count]) => count > 0)
          .map(([status, count]) => `${status}: ${count}`)
          .join(", ")})`,
    );
    if (score < threshold)
      throw new Error(
        `Mutation score ${score.toFixed(2)}% is below ${threshold}%`,
      );
    return;
  }
  throw new Error(`Unknown command: ${String(command)}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2));
