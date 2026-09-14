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

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mutationSourceFiles, mutationWorkspaces } from "./mutation-scope.mjs";
import { mergeMutationReports } from "./mutation-sharding.mjs";

/** Ranges closer than this merge, since a mutant needs its neighbours anyway. */
const coalesceGap = 3;

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

/**
 * The `--mutate` argument value for one workspace, or undefined when inert.
 *
 * Every entry is a range. A file the diff touches in many places produces many
 * of them rather than collapsing to the whole file: collapsing would mutate
 * lines the pull request never wrote, and their pre-existing survivors are
 * exactly the untouched-legacy-debt failure this gate exists to avoid. Stryker
 * takes the list comma-separated, so length costs characters and nothing else.
 */
export function mutateArgument(entries) {
  const parts = [];
  for (const { file, ranges } of entries)
    for (const [start, end] of ranges) parts.push(`${file}:${start}-${end}`);
  return parts.length === 0 ? undefined : parts.join(",");
}

/**
 * Score a Stryker report and fail below the threshold.
 *
 * A changed line can carry no mutant at all — a declaration, a type-only
 * expression, a comment moved onto a code line — and that is a pass, not a
 * perfect score: there was nothing for a test to detect.
 */
function gate(reportFile, threshold) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const { score, counts } = mergeMutationReports([report]);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    console.log("the changed lines carry no mutant.");
    return;
  }
  const detail = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  console.log(
    `mutation score ${score.toFixed(2)}% over ${total} mutants (${detail})`,
  );
  if (score < threshold)
    throw new Error(
      `Mutation score ${score.toFixed(2)}% is below ${threshold}%`,
    );
}

function option(arguments_, name, fallback) {
  const index = arguments_.indexOf(name);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`Missing required ${name}`);
    return fallback;
  }
  const value = arguments_[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

/** The report every workspace's Stryker configuration writes. */
const reportFile = "reports/mutation/mutation.json";

/**
 * The pnpm arguments that mutate `mutate` in `workspace`.
 *
 * Through the workspace's own `test:mutation`, not the Stryker CLI: each one
 * builds the workspace dependencies Stryker's TypeScript checker needs, and
 * duplicating that build here would let the two drift. `pnpm run --filter`,
 * not `pnpm --filter … --`: the latter forwards the separator itself into the
 * script, and Stryker rejects a bare `--`.
 */
export function mutationArguments(workspace, mutate, root = process.cwd()) {
  const { name } = JSON.parse(
    readFileSync(path.join(root, workspace, "package.json"), "utf8"),
  );
  return [
    "run",
    "--filter",
    name,
    "test:mutation",
    "--mutate",
    mutate,
    "--reporters",
    "clear-text,html,json,progress-append-only",
  ];
}

function main(arguments_) {
  const [command] = arguments_;
  if (command === "plan") {
    const base = option(arguments_, "--base");
    const ranges = changedLineRanges(base);
    console.log(
      JSON.stringify(
        Object.fromEntries(
          mutationWorkspaces.map((workspace) => [
            workspace,
            mutateArgument(ranges[workspace]) ?? null,
          ]),
        ),
      ),
    );
    return;
  }
  if (command === "run") {
    const workspace = option(arguments_, "--workspace");
    if (!mutationWorkspaces.includes(workspace))
      throw new Error(`Unknown mutation workspace: ${workspace}`);
    const base = option(arguments_, "--base");
    const threshold = Number(option(arguments_, "--threshold", "80"));
    const mutate = mutateArgument(changedLineRanges(base)[workspace]);
    if (!mutate) {
      console.log(`${workspace}: the diff changes no mutable line.`);
      return;
    }
    console.log(`${workspace}: mutating ${mutate.split(",").length} ranges`);
    const result = spawnSync("pnpm", mutationArguments(workspace, mutate), {
      cwd: path.resolve("."),
      stdio: "inherit",
    });
    if (result.status !== 0)
      throw new Error(`${workspace}: Stryker exited with ${result.status}`);
    gate(path.join(path.resolve(workspace), reportFile), threshold);
    return;
  }
  if (command === "gate") {
    const file = arguments_[1];
    if (!file) throw new Error("gate requires a report file");
    gate(file, Number(option(arguments_, "--threshold", "80")));
    return;
  }
  throw new Error(`Unknown command: ${String(command)}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2));
