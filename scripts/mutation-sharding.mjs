import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    } else {
      strykerArguments.push(argument);
    }
  }

  if (!shardValue) throw new Error("Missing required --shard N/TOTAL option");
  return { shard: parseShard(shardValue), strykerArguments };
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
    if (report.schemaVersion !== reports[0].schemaVersion) {
      throw new Error("Mutation reports use different schema versions");
    }
    for (const [file, result] of Object.entries(report.files ?? {})) {
      if (file in files)
        throw new Error(`Duplicate mutation report file: ${file}`);
      files[file] = result;
      for (const mutant of result.mutants ?? []) {
        const key = countByStatus[mutant.status];
        if (key) counts[key] += 1;
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

function mutationSourceFiles() {
  return globSync("src/**/*.ts")
    .filter(
      (file) => !file.endsWith(".test.ts") && !file.startsWith("src/testing/"),
    )
    .sort();
}

async function runShard(arguments_) {
  const { shard, strykerArguments } = parseRunArguments(arguments_);
  const files = selectShardFiles(mutationSourceFiles(), shard);
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
  throw new Error("Usage: mutation-sharding.mjs <run|aggregate>");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
