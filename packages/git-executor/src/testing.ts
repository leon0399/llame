import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * The temp-repository fixture the real-git suites share. A git hook exports
 * local variables (`GIT_DIR`, `GIT_INDEX_FILE`, ...) that would aim the
 * operations at the checkout running the suite, so they are cleared at module
 * load. Every command a test starts itself pins `core.hooksPath=/dev/null`, so
 * host hooks never run inside a temp repo, and each repo sets its identity and
 * disables line-ending rewriting.
 */
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"])
  .toString()
  .split("\n")) {
  if (name !== "") delete process.env[name];
}

const created: Array<string> = [];

export const GIT_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
};

/** A temp directory this suite removes in `cleanupRepositories`. */
export function tempDirectory(prefix = "git-executor-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

export function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    ...GIT_OPTIONS,
    cwd,
  });
}

/** The standard error of a git command a test expects to fail. */
export function gitStderr(cwd: string, args: ReadonlyArray<string>): string {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    ...GIT_OPTIONS,
    cwd,
  });
  return result.stderr;
}

export function initRepository(directory: string): string {
  mkdirSync(directory, { recursive: true });
  runGit(directory, ["init", "--quiet", "--initial-branch=main", "."]);
  runGit(directory, ["config", "user.name", "llame tests"]);
  runGit(directory, ["config", "user.email", "llame@test.invalid"]);
  runGit(directory, ["config", "core.autocrlf", "false"]);
  return directory;
}

export function commitFile(directory: string, name: string): void {
  writeFileSync(join(directory, name), `${name}\n`);
  runGit(directory, ["add", name]);
  runGit(directory, ["commit", "--quiet", "--message", `add ${name}`]);
}

export function repositoryWithCommit(): string {
  const directory = initRepository(tempDirectory());
  commitFile(directory, "README.md");
  return directory;
}

/**
 * Run `work` with a `git` on PATH that sleeps instead of doing anything, for a
 * timeout or cancellation test. The shim `exec`s the sleeper, so the process
 * the deadline kills is the sleeper itself and not a shell whose child would
 * keep the pipes open past the deadline.
 */
export async function withSlowGit<T>(work: () => Promise<T>): Promise<T> {
  const shim = tempDirectory("git-slow-");
  writeFileSync(join(shim, "git"), "#!/bin/sh\nexec sleep 30\n", {
    mode: 0o755,
  });
  const previousPath = process.env["PATH"];
  process.env["PATH"] = `${shim}:${previousPath ?? ""}`;
  try {
    return await work();
  } finally {
    process.env["PATH"] = previousPath;
  }
}

/** Remove every temp directory this fixture created. */
export function cleanupRepositories(): void {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
}
