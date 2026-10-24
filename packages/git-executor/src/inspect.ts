import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { absolutePathArgument } from "./arguments";
import { STDERR_BOUND, boundedText, redactCredentials } from "./output";
import { runGitProcess, type GitProcessResult } from "./process";
import {
  type GitInspectFailure,
  type GitInspectResult,
  type GitRepositoryRemote,
} from "./types";

/**
 * `git.inspect`: one read-only look at a working tree, which answers what the
 * directory is (toplevel, linked worktree, main clone), where it came from
 * (remotes), and where it stands (branch, head).
 *
 * Nothing here writes, fetches, or contacts a network. The whole call shares
 * one deadline, so a hung git cannot multiply the timeout by the number of
 * probes it makes, and every process runs with the fixed environment, an empty
 * hooks directory, and `core.fsmonitor=false`.
 */

// The default budget of one `git.inspect` call, shared by every probe.
export const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/** Git's own wording for "this path holds no repository", plus the `-C`
 *  failures that mean the same thing to a caller. */
const NOT_A_REPOSITORY =
  /not a git repository|must be run in a work tree|not a work tree|cannot change to|cannot chdir/iu;

/** One step's result, or the failure that ended the inspection. */
type Step<T> = T | GitInspectFailure;

type GitRunner = (args: ReadonlyArray<string>) => Promise<GitProcessResult>;

function redactedStderr(result: GitProcessResult): string {
  return redactCredentials(boundedText(result.stderr, STDERR_BOUND)).trim();
}

function failedInspection(
  result: Exclude<GitProcessResult, { readonly status: "ok" }>,
): GitInspectFailure {
  if (result.status === "timed_out") {
    return {
      status: "error",
      type: "timed_out",
      stderr: redactedStderr(result),
    };
  }
  const stderr = redactedStderr(result);
  return {
    status: "error",
    type: NOT_A_REPOSITORY.test(stderr) ? "not_a_repository" : "git_failed",
    stderr,
  };
}

/** One record per remote URL: `remote.<name>.url\n<url>` up to a NUL. */
function parseRemoteRecords(stdout: string): Array<GitRepositoryRemote> {
  const remotes: Array<GitRepositoryRemote> = [];
  for (const record of stdout.split("\0")) {
    const separator = record.indexOf("\n");
    if (separator === -1) continue;
    const key = record.slice(0, separator);
    const name = key.slice("remote.".length, key.length - ".url".length);
    if (!key.startsWith("remote.") || !key.endsWith(".url") || name === "") {
      continue;
    }
    remotes.push({ name, url: record.slice(separator + 1) });
  }
  return remotes;
}

/** The main working tree is the first entry `git worktree list` reports. */
function mainWorktreePath(porcelain: string): string | null {
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) return line.slice("worktree ".length);
  }
  return null;
}

function absoluteDirectories(stdout: string) {
  const [commonDir = "", gitDir = ""] = stdout
    .split("\n")
    .filter((line) => line !== "");
  return { commonDir, gitDir };
}

/** What the path is: its toplevel, its common directory, and whether it is a
 *  linked worktree of another working tree. */
async function workingTree(git: GitRunner): Promise<
  Step<{
    readonly toplevel: string;
    readonly commonDir: string;
    readonly linked: boolean;
    readonly mainWorktree: string | null;
  }>
> {
  const toplevel = await git(["rev-parse", "--show-toplevel"]);
  if (toplevel.status !== "ok") return failedInspection(toplevel);

  const directories = await git([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
    "--git-dir",
  ]);
  if (directories.status !== "ok") return failedInspection(directories);
  const { commonDir, gitDir } = absoluteDirectories(directories.stdout);
  const linked = gitDir !== commonDir;

  const worktreeList = linked
    ? await git(["worktree", "list", "--porcelain"])
    : undefined;
  if (worktreeList !== undefined && worktreeList.status !== "ok") {
    return failedInspection(worktreeList);
  }
  return {
    toplevel: toplevel.stdout.trim(),
    commonDir,
    linked,
    mainWorktree: linked ? mainWorktreePath(worktreeList?.stdout ?? "") : null,
  };
}

/** Every configured remote URL, which is what identity is derived from. */
async function remoteUrls(
  git: GitRunner,
): Promise<Step<ReadonlyArray<GitRepositoryRemote>>> {
  const remotes = await git([
    "config",
    "--null",
    "--get-regexp",
    String.raw`^remote\..*\.url$`,
  ]);
  // `git config --get-regexp` exits 1 when nothing matches, which is a
  // repository without a remote, not a failed call.
  if (remotes.status === "timed_out") return failedInspection(remotes);
  if (remotes.status === "failed" && remotes.exitCode !== 1) {
    return failedInspection(remotes);
  }
  return parseRemoteRecords(remotes.status === "ok" ? remotes.stdout : "");
}

/** The branch name, or `null` on a detached HEAD; the commit, or `null` on an
 *  unborn branch. Neither is fatal: a fresh clone has no commit. */
async function position(
  git: GitRunner,
): Promise<
  Step<{ readonly branch: string | null; readonly head: string | null }>
> {
  const branch = await git(["symbolic-ref", "--short", "--quiet", "HEAD"]);
  if (branch.status === "timed_out") return failedInspection(branch);
  const head = await git(["rev-parse", "--verify", "HEAD"]);
  if (head.status === "timed_out") return failedInspection(head);
  return {
    branch: branch.status === "ok" ? branch.stdout.trim() : null,
    head: head.status === "ok" ? head.stdout.trim() : null,
  };
}

async function inspectWithin(git: GitRunner): Promise<GitInspectResult> {
  const tree = await workingTree(git);
  if ("status" in tree) return tree;
  const remotes = await remoteUrls(git);
  if ("status" in remotes) return remotes;
  const at = await position(git);
  if ("status" in at) return at;
  return { status: "ok", ...tree, remotes, ...at };
}

/**
 * Everything that precedes the subcommand: the two configuration overrides
 * that keep a repository's hooks and file-system monitor out of the call, then
 * the working directory the caller named. The path is validated before this
 * runs, so the `-C` value can never be read as an option itself.
 */
export function gitPrefixArguments(
  hooksDirectory: string,
  path: string,
): Array<string> {
  return [
    "-c",
    `core.hooksPath=${hooksDirectory}`,
    "-c",
    "core.fsmonitor=false",
    "-C",
    path,
  ];
}

export async function inspectRepository(
  input: { readonly path: string },
  options: { readonly timeoutMs?: number } = {},
): Promise<GitInspectResult> {
  const path = absolutePathArgument(input.path);
  if (!path.ok) {
    return { status: "error", type: "invalid_input", message: path.message };
  }

  const endsAt = Date.now() + (options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
  // One empty directory per call, removed afterwards, so a repository's own
  // hooks can never be found by `core.hooksPath`.
  const hooksDirectory = await mkdtemp(join(tmpdir(), "llame-git-hooks-"));
  const prefix = gitPrefixArguments(hooksDirectory, path.path);
  const git: GitRunner = (args) =>
    runGitProcess([...prefix, ...args], { timeoutMs: endsAt - Date.now() });

  try {
    return endsAt <= Date.now()
      ? {
          status: "error",
          type: "timed_out",
          stderr: "git did not finish within its timeout.",
        }
      : await inspectWithin(git);
  } finally {
    await rm(hooksDirectory, { recursive: true, force: true });
  }
}
