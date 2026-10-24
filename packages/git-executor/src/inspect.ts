import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { runGitProcess, redactCredentials, type GitProcessResult } from "./run";

/*
 * `git.inspect`: one read-only look at a working tree, which answers what the
 * directory is (toplevel, linked worktree, main clone), where it came from
 * (remotes), and where it stands (branch, head).
 *
 * Nothing here writes, fetches, or contacts a network. The whole call shares one
 * deadline, so a hung git cannot multiply the timeout by the number of probes it
 * makes, and every process runs with the fixed environment, an empty hooks
 * directory, and `core.fsmonitor=false`. A caller value reaches git as one
 * argv element after `-C`, and a path that is not absolute never reaches git at
 * all.
 */

/** One configured remote of a repository. */
export type GitRepositoryRemote = {
  readonly name: string;
  readonly url: string;
};

/** Everything registration and adoption need from one inspection. */
export type GitInspectSuccess = {
  readonly status: "ok";
  /** The working tree root git reports for the submitted path. */
  readonly toplevel: string;
  /** `git rev-parse --git-common-dir`, absolute. */
  readonly commonDir: string;
  /** Whether the path is a linked worktree rather than the main working tree. */
  readonly linked: boolean;
  /** The main working tree's root; `null` unless `linked`. */
  readonly mainWorktree: string | null;
  readonly remotes: ReadonlyArray<GitRepositoryRemote>;
  /** `null` on a detached HEAD. */
  readonly branch: string | null;
  /** `null` on an unborn branch, which has no commit yet. */
  readonly head: string | null;
};

/**
 * A refused or failed call. `invalid_input` is refused before git starts;
 * every other type comes from a started process, and carries the bounded,
 * redacted standard error git wrote.
 */
export type GitInspectFailure =
  | {
      readonly status: "error";
      readonly type: "invalid_input";
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly type: "not_a_repository" | "timed_out" | "git_failed";
      readonly stderr: string;
    };

export type GitInspectResult = GitInspectSuccess | GitInspectFailure;

/** The default budget of one `git.inspect` call, shared by every probe. */
const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/** Git's own wording for "this path holds no repository", plus the `-C`
 *  failures that mean the same thing to a caller. */
const NOT_A_REPOSITORY =
  /not a git repository|must be run in a work tree|not a work tree|cannot change to|cannot chdir/iu;

/** One step's result, or the failure that ended the inspection. */
type Step<T> = T | GitInspectFailure;

type GitRunner = (args: ReadonlyArray<string>) => Promise<GitProcessResult>;

function redactedStderr(result: GitProcessResult): string {
  return redactCredentials(result.stderr).trim();
}

function failedInspection(
  result: Exclude<GitProcessResult, { readonly status: "ok" }>,
): GitInspectFailure {
  const stderr = redactedStderr(result);
  const type =
    result.status === "timed_out"
      ? "timed_out"
      : NOT_A_REPOSITORY.test(stderr)
        ? "not_a_repository"
        : "git_failed";
  return { status: "error", type, stderr };
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

/**
 * The main working tree is the first record `git worktree list --porcelain -z`
 * reports. `-z` keeps a path that holds a newline in one record instead of
 * splitting it across lines.
 */
function mainWorktreePath(porcelain: string): string | null {
  for (const record of porcelain.split("\0")) {
    if (record.startsWith("worktree ")) {
      return record.slice("worktree ".length);
    }
  }
  return null;
}

/**
 * The one newline git ends a line of output with. Only that newline is
 * removed: a directory name may hold a newline of its own, or end in spaces,
 * and both belong to the path.
 */
function withoutTrailingNewline(value: string): string {
  return value.replace(/\n$/u, "");
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

  // One call per directory, not one call for both: two paths on two lines
  // cannot be split again when a path holds a newline, and a main clone at
  // `/tmp/x/main\nclone` would then read as a linked worktree of `/tmp/x/main`.
  const common = await git([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (common.status !== "ok") return failedInspection(common);
  const own = await git(["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (own.status !== "ok") return failedInspection(own);
  const commonDir = withoutTrailingNewline(common.stdout);
  const gitDir = withoutTrailingNewline(own.stdout);
  const linked = gitDir !== commonDir;

  const worktreeList = linked
    ? await git(["worktree", "list", "--porcelain", "-z"])
    : undefined;
  if (worktreeList !== undefined && worktreeList.status !== "ok") {
    return failedInspection(worktreeList);
  }
  return {
    toplevel: withoutTrailingNewline(toplevel.stdout),
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
 * Everything that precedes the subcommand: the two configuration overrides that
 * keep a repository's hooks and file-system monitor out of the call, then the
 * working directory the caller named. The path is validated before this runs,
 * so the `-C` value can never be read as an option itself.
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

/** The refusal of a path that git must never receive as an argv element. */
function absolutePath(
  value: string,
): { readonly path: string } | { readonly message: string } {
  if (value.includes("\0")) {
    return { message: "A git path must not contain a NUL byte." };
  }
  return isAbsolute(value)
    ? { path: value }
    : { message: "A git path must be absolute." };
}

export async function inspectRepository(
  input: { readonly path: string },
  options: { readonly timeoutMs?: number } = {},
): Promise<GitInspectResult> {
  const path = absolutePath(input.path);
  if (!("path" in path)) {
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
    return await inspectWithin(git);
  } finally {
    await rm(hooksDirectory, { recursive: true, force: true });
  }
}
