import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  apiShardCount,
  hasCommit,
  isAncestor,
  mergeMutationBaseline,
  mutationBaselineFile,
  mutationFingerprint,
  mutationSourceFiles,
  mutationWorkspaces,
  readMutationBaselineFile,
  readMutationBaselines,
  readMutationScope,
  repositoryRoot,
  resolveCommit,
} from "./mutation-scope.mjs";

export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (!match) throw new Error(`Invalid shard: ${value}`);

  const number = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isSafeInteger(number) ||
    !Number.isSafeInteger(total) ||
    number < 1 ||
    total < 1 ||
    number > total
  ) {
    throw new Error(`Invalid shard: ${value}`);
  }

  return { index: number - 1, number, total };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

// Distributes files over the runner pool by the work each one carries. Shard
// duration tracks mutant count, not file count or bytes, so files are assigned
// longest-processing-time-first: heaviest first, each onto the least loaded
// shard. Files the baseline does not know — new sources, or no baseline at all
// — fall back to the median measured weight.
export function assignShardFiles(files, weights, total) {
  const known = files
    .map((file) => weights?.get(file))
    .filter((weight) => typeof weight === "number");
  const fallback = known.length === 0 ? 1 : median(known);
  const weightOf = (file) => weights?.get(file) ?? fallback;
  const shards = Array.from({ length: total }, () => ({ load: 0, files: [] }));

  const ordered = [...files].sort(
    (left, right) =>
      weightOf(right) - weightOf(left) || compareText(left, right),
  );
  for (const file of ordered) {
    const shard = shards.reduce((best, candidate) =>
      candidate.load < best.load ? candidate : best,
    );
    shard.load += weightOf(file);
    shard.files.push(file);
  }
  return shards.map((shard) => shard.files.sort());
}

export function parseRunArguments(arguments_) {
  let shardValue;
  let mutate;
  const strykerArguments = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--shard") {
      if (shardValue) throw new Error("Pass --shard exactly once");
      shardValue = arguments_[index + 1];
      index += 1;
    } else if (argument.startsWith("--shard=")) {
      if (shardValue) throw new Error("Pass --shard exactly once");
      shardValue = argument.slice("--shard=".length);
    } else if (argument === "--mutate") {
      if (mutate) throw new Error("Pass --mutate exactly once");
      mutate = arguments_[index + 1];
      index += 1;
    } else if (argument.startsWith("--mutate=")) {
      if (mutate) throw new Error("Pass --mutate exactly once");
      mutate = argument.slice("--mutate=".length);
    } else {
      strykerArguments.push(argument);
    }
  }

  if (!shardValue) throw new Error("Missing required --shard N/TOTAL option");
  // The plan already decided which files this shard owns; re-deriving them here
  // would duplicate the scope computation and could disagree with the matrix.
  if (!mutate) throw new Error("Missing required --mutate file list");
  const files = mutate.split(",");
  if (files.some((file) => file.length === 0))
    throw new Error("--mutate received an empty file name");

  return {
    shard: parseShard(shardValue),
    files: files.sort(),
    strykerArguments,
  };
}

export function resolveStrykerCli(workspace = process.cwd()) {
  return path.join(
    workspace,
    "node_modules/@stryker-mutator/core/bin/stryker.js",
  );
}

export function mergeMutationReports(reports) {
  if (reports.length === 0) throw new Error("No mutation reports supplied");

  const files = {};
  const counts = {
    killed: 0,
    timeout: 0,
    survived: 0,
    noCoverage: 0,
    compileError: 0,
    runtimeError: 0,
  };
  const countByStatus = {
    Killed: "killed",
    Timeout: "timeout",
    Survived: "survived",
    NoCoverage: "noCoverage",
    CompileError: "compileError",
    RuntimeError: "runtimeError",
  };

  for (const report of reports) {
    if (
      !report ||
      typeof report.schemaVersion !== "string" ||
      !report.schemaVersion ||
      !report.files ||
      typeof report.files !== "object" ||
      Array.isArray(report.files)
    ) {
      throw new Error("Invalid mutation report");
    }
    if (report.schemaVersion !== reports[0].schemaVersion) {
      throw new Error("Mutation reports use different schema versions");
    }
    for (const [file, result] of Object.entries(report.files ?? {})) {
      if (!result || !Array.isArray(result.mutants))
        throw new Error(`Invalid mutant list for ${file}`);
      if (file in files)
        throw new Error(`Duplicate mutation report file: ${file}`);
      files[file] = result;
      for (const mutant of result.mutants ?? []) {
        const key = countByStatus[mutant.status];
        if (Object.hasOwn(countByStatus, mutant.status)) counts[key] += 1;
        else if (mutant.status !== "Ignored")
          throw new Error(
            `Unfinished or unknown mutant status: ${mutant.status}`,
          );
      }
    }
  }

  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived + counts.noCoverage;
  return {
    counts,
    score: valid === 0 ? 100 : (detected / valid) * 100,
    report: { ...reports[0], files },
  };
}

async function runShard(arguments_) {
  const { shard, files, strykerArguments } = parseRunArguments(arguments_);

  console.log(
    `Mutation shard ${shard.number}/${shard.total}: ${files.length} source files`,
  );
  const incrementalFile = `reports/stryker-incremental-${shard.number}-of-${shard.total}.json`;
  const child = spawn(
    process.execPath,
    [
      resolveStrykerCli(),
      "run",
      "--mutate",
      files.join(","),
      "--incrementalFile",
      incrementalFile,
      ...strykerArguments,
    ],
    { stdio: "inherit" },
  );
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) process.kill(process.pid, result.signal);
  process.exitCode = result.code ?? 1;
}

export function mutationPlan(scopes, baselines = {}) {
  const measured = baselines["apps/api"];
  const weights = measured
    ? new Map(
        Object.entries(measured.files).map(([file, entry]) => [
          file,
          entry.mutants,
        ]),
      )
    : undefined;
  let shardCount = apiShardCount;
  if (scopes["apps/api"].mode === "scoped" && weights?.size) {
    const values = [...weights.values()];
    const target = Math.max(
      1,
      values.reduce((sum, weight) => sum + weight, 0) / apiShardCount,
    );
    const fallback = median(values);
    const selected = scopes["apps/api"].files.reduce(
      (sum, file) => sum + (weights.get(file) ?? fallback),
      0,
    );
    // Reuse the full corpus's average shard workload as the scoped budget.
    // Small diffs should not repeat setup and checker startup on eight runners.
    shardCount = Math.min(
      apiShardCount,
      Math.max(1, Math.ceil(selected / target)),
    );
  }
  const apiShards = assignShardFiles(
    scopes["apps/api"].files,
    weights,
    shardCount,
  )
    .map((files, index) => ({
      shard: `${index + 1}/${apiShardCount}`,
      index,
      files,
    }))
    .filter(({ files }) => files.length > 0);
  return {
    apiMode: scopes["apps/api"].mode,
    apiShards,
    packages: mutationWorkspaces.slice(1).map((workspace) => ({
      package: workspace.slice("packages/".length),
      mode: scopes[workspace].mode,
    })),
  };
}

function scopeArguments(arguments_) {
  const { values } = parseArgs({
    args: arguments_.filter((argument) => argument !== "--"),
    options: {
      base: { type: "string" },
      workspace: { type: "string" },
      dryRunOnly: { type: "boolean" },
      full: { type: "boolean" },
      "from-baseline": { type: "boolean" },
      expectedMode: { type: "string" },
    },
  });
  if (values.base === "") throw new Error("--base requires a ref");
  if (values.workspace && !mutationWorkspaces.includes(values.workspace))
    throw new Error("Unknown mutation workspace");
  if (
    values.expectedMode !== undefined &&
    !["skip", "scoped"].includes(values.expectedMode)
  )
    throw new Error("--expectedMode must be skip or scoped");
  return values;
}

function requireMutationDelta(workspace, scope, baseline) {
  const reason =
    scope.mode === "unavailable"
      ? scope.reason
      : scope.mode === "scoped" && !baseline
        ? "No compatible ancestor mutation baseline"
        : undefined;
  if (reason)
    throw new Error(
      `${workspace}: mutation delta unavailable: ${reason}. No mutation execution was scheduled.`,
    );
}

function plan(arguments_) {
  const {
    base,
    full,
    "from-baseline": fromBaseline,
  } = scopeArguments(arguments_);
  const root = repositoryRoot();
  const baselines = readMutationBaselines(root);
  const resolved = hasCommit(base ?? "", root) ? base : undefined;
  // A cancelled master run must not leave its files out of every later diff.
  // Each workspace resumes from the revision its own index actually measured.
  const bases =
    fromBaseline && full !== true
      ? Object.fromEntries(
          mutationWorkspaces.map((workspace) => [
            workspace,
            baselines[workspace]?.revision ?? resolved,
          ]),
        )
      : resolved;
  const scopes = full
    ? Object.fromEntries(
        mutationWorkspaces.map((workspace) => [
          workspace,
          {
            mode: "full",
            files: mutationSourceFiles(path.join(root, workspace)),
          },
        ]),
      )
    : readMutationScope(bases, baselines, root);
  for (const workspace of mutationWorkspaces)
    requireMutationDelta(workspace, scopes[workspace], baselines[workspace]);
  const result = mutationPlan(scopes, baselines);
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `api_mode=${result.apiMode}`,
        `api_count=${result.apiShards.length}`,
        `api_matrix=${JSON.stringify(result.apiShards)}`,
        `packages=${JSON.stringify(result.packages)}`,
        "",
      ].join("\n"),
    );
  }
}

async function execute(command, arguments_, cwd) {
  const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => resolve(status));
  });
  if (code !== 0) throw new Error(`${command} failed with exit status ${code}`);
}

async function changed(arguments_) {
  const options = scopeArguments(arguments_);
  const root = repositoryRoot();
  const baselines = readMutationBaselines(root);
  const scopes = readMutationScope(
    options["from-baseline"]
      ? Object.fromEntries(
          mutationWorkspaces.map((workspace) => [
            workspace,
            baselines[workspace]?.revision ?? options.base ?? "origin/master",
          ]),
        )
      : (options.base ?? "origin/master"),
    baselines,
    root,
  );
  const workspaces = mutationWorkspaces.filter(
    (workspace) => !options.workspace || options.workspace === workspace,
  );
  // Validate every selected workspace before starting any dependency build or
  // mutation process. Unknown impact never expands into a full local/CI run.
  for (const workspace of workspaces) {
    const scope = scopes[workspace];
    if (!options.dryRunOnly || scope.mode === "unavailable")
      requireMutationDelta(workspace, scope, baselines[workspace]);
    if (
      options.expectedMode !== undefined &&
      scope.mode !== options.expectedMode
    )
      throw new Error(
        `${workspace}: planned ${options.expectedMode} but this run resolved ${scope.mode}`,
      );
  }
  for (const workspace of workspaces) {
    const scope = scopes[workspace];
    console.log(
      `${workspace}: ${scope.mode} mutation scope (${scope.files.length} files)`,
    );
    if (scope.mode === "skip") continue;
    if (workspace === "apps/api")
      await execute(
        "pnpm",
        ["--filter", "api^...", "--workspace-concurrency=1", "-r", "build"],
        root,
      );
    const directory = path.resolve(root, workspace);
    const args = [
      resolveStrykerCli(directory),
      "run",
      "--mutate",
      scope.files.join(","),
    ];
    if (options.dryRunOnly) args.push("--dryRunOnly");
    await execute(process.execPath, args, directory);
    if (options.dryRunOnly) continue;
    const report = path.join(directory, "reports/mutation/mutation.json");
    aggregate([
      "--baseline",
      path.join(directory, mutationBaselineFile),
      report,
    ]);
  }
}

function readOption(arguments_, option) {
  const index = arguments_.indexOf(option);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  arguments_.splice(index, 2);
  return value;
}

function stepSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${lines.join("\n")}\n`);
}

// Source files whose undetected mutant count grew against the baseline. A file
// the baseline never measured — a new source — has no allowance to spend.
export function mutationRegressions(baseline, current) {
  return Object.entries(current.files)
    .map(([file, entry]) => ({
      file,
      undetected: entry.undetected,
      previous: baseline.files[file]?.undetected ?? 0,
    }))
    .filter(({ undetected, previous }) => undetected > previous)
    .sort((left, right) => compareText(left.file, right.file));
}

// Compares a scoped run against its baseline: only the files this run measured
// are judged, and only growth in undetected mutants fails.
function mutationDelta(baselinePath, reports) {
  const baseline = readMutationBaselineFile(baselinePath);
  const current = mergeMutationBaseline(undefined, reports);
  const regressions = mutationRegressions(baseline, current);
  const files = Object.keys(current.files);
  const scopedUndetected = (source) =>
    files.reduce((sum, file) => sum + (source.files[file]?.undetected ?? 0), 0);
  const lines = [
    `Undetected mutants (survived or uncovered): ${scopedUndetected(current)} across ${files.length} source files (baseline ${scopedUndetected(baseline)})`,
  ];
  if (regressions.length === 0) lines.push("", "No new undetected mutants.");
  else
    lines.push(
      "",
      `New undetected mutants in ${regressions.length} source files:`,
      ...regressions.map(
        ({ file, undetected, previous }) =>
          `- ${file}: ${previous} -> ${undetected}`,
      ),
    );
  return {
    lines,
    failure:
      regressions.length === 0
        ? undefined
        : `${regressions.length} source files gained undetected mutants`,
  };
}

function aggregate(arguments_) {
  const inputs = arguments_.filter((argument) => argument !== "--");
  const thresholdValue = readOption(inputs, "--threshold");
  const baselinePath = readOption(inputs, "--baseline");
  const expectedValue = readOption(inputs, "--expected-shards");
  const expected = Number(expectedValue ?? inputs.length);
  const threshold =
    thresholdValue === undefined ? undefined : Number(thresholdValue);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("--expected-shards must be a positive integer");
  }
  if (inputs.length !== expected) {
    throw new Error(
      `Expected ${expected} mutation reports, received ${inputs.length}`,
    );
  }
  if (
    threshold !== undefined &&
    (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
  ) {
    throw new Error("--threshold must be between 0 and 100");
  }
  if (threshold !== undefined && baselinePath !== undefined) {
    throw new Error("Pass --threshold or --baseline, not both");
  }

  const reports = inputs.map((file) => JSON.parse(readFileSync(file, "utf8")));
  const result = mergeMutationReports(reports);
  let failure;
  let lines = [];
  if (baselinePath === undefined) {
    if (threshold !== undefined && result.score < threshold) {
      failure = `Mutation score ${result.score.toFixed(2)}% is below ${threshold}%`;
    }
  } else {
    ({ failure, lines } = mutationDelta(baselinePath, reports));
  }

  const summary = [
    "### Mutation",
    "",
    `Score: ${result.score.toFixed(2)}%`,
    Object.entries(result.counts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", "),
    ...lines,
  ];
  console.log(summary.slice(2).join("\n"));
  stepSummary(summary);
  if (failure !== undefined) throw new Error(failure);
}

// Folds this run's shard reports into the workspace's baseline index. The
// previous index is carried forward, so a scoped run refreshes the files it
// measured without discarding the rest of the corpus.
function buildBaseline(arguments_) {
  const inputs = arguments_.filter((argument) => argument !== "--");
  const previousPath = readOption(inputs, "--previous");
  const outputPath = readOption(inputs, "--output");
  const full = inputs.includes("--full");
  if (full) inputs.splice(inputs.indexOf("--full"), 1);
  if (outputPath === undefined) throw new Error("--output is required");
  if (inputs.length === 0) throw new Error("Pass at least one mutation report");

  const reports = inputs.map((file) => JSON.parse(readFileSync(file, "utf8")));
  // Same integrity rules as the gate: a crashed shard must not become the
  // oracle the next delta is measured against.
  mergeMutationReports(reports);
  let previous =
    previousPath !== undefined && existsSync(previousPath)
      ? readMutationBaselineFile(previousPath)
      : undefined;
  const root = repositoryRoot();
  const revision = resolveCommit("HEAD", root);
  if (previous && !hasCommit(previous.revision, root)) {
    console.log(
      `Discarding unreachable baseline revision ${previous.revision}`,
    );
    previous = undefined;
  }
  // Refresh jobs serialize restore/fold/save, but older measurements can
  // finish later. Never replace a descendant's index with an older revision.
  const newer =
    previous &&
    previous.revision !== revision &&
    isAncestor(revision, previous.revision, root);
  const baseline = newer
    ? previous
    : {
        ...mergeMutationBaseline(full ? undefined : previous, reports),
        revision,
      };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(baseline)}\n`);
  console.log(
    newer
      ? `Keeping newer baseline ${previous.revision}; measurement ${revision} was not folded`
      : `Mutation baseline: ${Object.keys(baseline.files).length} source files from ${reports.length} reports`,
  );
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "run") return runShard(arguments_);
  if (command === "aggregate") return aggregate(arguments_);
  if (command === "baseline") return buildBaseline(arguments_);
  if (command === "plan") return plan(arguments_);
  if (command === "changed") return changed(arguments_);
  if (command === "fingerprint") {
    const { workspace } = scopeArguments(arguments_);
    if (!workspace) throw new Error("fingerprint requires --workspace");
    console.log(mutationFingerprint(workspace));
    return;
  }
  throw new Error(
    "Usage: mutation-sharding.mjs <run|aggregate|baseline|plan|changed|fingerprint>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
