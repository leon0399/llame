import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  mutationFingerprint,
  mutationSourceFiles,
  mutationWorkspaces,
  readMutationScope,
} from "./mutation-scope.mjs";

// Fixed namespace keeps assignments stable and the current eight shards balanced.
const SHARD_NAMESPACE = "v4517";

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

function shardIndex(file, total) {
  return (
    createHash("sha256")
      .update(`${SHARD_NAMESPACE}:${file}`)
      .digest()
      .readUInt32BE(0) % total
  );
}

export function selectShardFiles(files, shard) {
  return [...files]
    .sort()
    .filter((file) => shardIndex(file, shard.total) === shard.index);
}

export function parseRunArguments(arguments_) {
  let shardValue;
  let base;
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
    } else if (argument === "--base") {
      if (base !== undefined) throw new Error("Pass --base exactly once");
      base = arguments_[index + 1];
      if (!base || base.startsWith("--"))
        throw new Error("--base requires a ref");
      index += 1;
    } else {
      strykerArguments.push(argument);
    }
  }

  if (!shardValue) throw new Error("Missing required --shard N/TOTAL option");
  const result = { shard: parseShard(shardValue), strykerArguments };
  if (base !== undefined) result.base = base;
  return result;
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
  const { shard, strykerArguments, base } = parseRunArguments(arguments_);
  const scope =
    base === undefined
      ? { mode: "full", files: mutationSourceFiles(process.cwd()) }
      : readMutationScope(base)["apps/api"];
  const files = selectShardFiles(scope.files, shard);
  if (files.length === 0)
    throw new Error(`Mutation shard ${shard.number} is empty`);

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
      ...strykerArguments.filter(
        (argument) => scope.mode !== "changed" || argument !== "--incremental",
      ),
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

export function mutationPlan(scopes) {
  const apiShards = Array.from({ length: 8 }, (_, index) => ({
    shard: `${index + 1}/8`,
    index,
  })).filter(
    ({ shard }) =>
      selectShardFiles(scopes["apps/api"].files, parseShard(shard)).length > 0,
  );
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
    },
  });
  if (values.base === "") throw new Error("--base requires a ref");
  if (values.workspace && !mutationWorkspaces.includes(values.workspace))
    throw new Error("Unknown mutation workspace");
  return values;
}

function plan(arguments_) {
  const { base } = scopeArguments(arguments_);
  const result = mutationPlan(readMutationScope(base));
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
  const scopes = readMutationScope(options.base ?? "origin/master");
  for (const workspace of mutationWorkspaces) {
    if (options.workspace && options.workspace !== workspace) continue;
    const scope = scopes[workspace];
    console.log(
      `${workspace}: ${scope.mode} mutation scope (${scope.files.length} files)`,
    );
    if (scope.mode === "skip") continue;
    if (workspace === "apps/api")
      await execute(
        "pnpm",
        ["--filter", "api^...", "--workspace-concurrency=1", "-r", "build"],
        process.cwd(),
      );
    const directory = path.resolve(workspace);
    const args = [
      resolveStrykerCli(directory),
      "run",
      "--mutate",
      scope.files.join(","),
    ];
    if (options.dryRunOnly) args.push("--dryRunOnly");
    await execute(process.execPath, args, directory);
    if (!options.dryRunOnly)
      aggregate([
        "--threshold",
        "80",
        path.join(directory, "reports/mutation/mutation.json"),
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

function aggregate(arguments_) {
  const inputs = arguments_.filter((argument) => argument !== "--");
  const thresholdValue = readOption(inputs, "--threshold");
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

  const reports = inputs.map((file) => JSON.parse(readFileSync(file, "utf8")));
  const result = mergeMutationReports(reports);
  console.log(`Mutation score: ${result.score.toFixed(2)}%`);
  console.log(
    Object.entries(result.counts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", "),
  );
  if (threshold !== undefined && result.score < threshold) {
    throw new Error(
      `Mutation score ${result.score.toFixed(2)}% is below ${threshold}%`,
    );
  }
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "run") return runShard(arguments_);
  if (command === "aggregate") return aggregate(arguments_);
  if (command === "plan") return plan(arguments_);
  if (command === "changed") return changed(arguments_);
  if (command === "fingerprint") {
    const { workspace } = scopeArguments(arguments_);
    if (!workspace) throw new Error("fingerprint requires --workspace");
    console.log(mutationFingerprint(workspace));
    return;
  }
  throw new Error(
    "Usage: mutation-sharding.mjs <run|aggregate|plan|changed|fingerprint>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
