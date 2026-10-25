import {
  absoluteGitPath,
  DEFAULT_GIT_TIMEOUT_MS,
  processFailure,
  withGit,
  type GitCallOptions,
  type GitRunner,
} from "./invocation";
import { parseWorktreeRecords } from "./worktrees";
import type {
  GitFailure,
  GitInspectResult,
  GitRepositoryRemote,
} from "@workspace/machine-protocol";

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

/** One step's result, or the failure that ended the inspection. */
type Step<T> = T | GitFailure;

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
  if (toplevel.status !== "ok") return processFailure(toplevel);

  // One call per directory, not one call for both: two paths on two lines
  // cannot be split again when a path holds a newline, and a main clone at
  // `/tmp/x/main\nclone` would then read as a linked worktree of `/tmp/x/main`.
  const common = await git([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (common.status !== "ok") return processFailure(common);
  const own = await git(["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (own.status !== "ok") return processFailure(own);
  const commonDir = withoutTrailingNewline(common.stdout);
  const gitDir = withoutTrailingNewline(own.stdout);
  const linked = gitDir !== commonDir;

  const worktreeList = linked
    ? await git(["worktree", "list", "--porcelain", "-z"])
    : undefined;
  if (worktreeList !== undefined && worktreeList.status !== "ok") {
    return processFailure(worktreeList);
  }
  return {
    toplevel: withoutTrailingNewline(toplevel.stdout),
    commonDir,
    linked,
    // The main working tree is the first record the listing reports: `-z`
    // keeps a path that holds a newline in one record instead of splitting it.
    mainWorktree: linked
      ? (parseWorktreeRecords(worktreeList?.stdout ?? "")[0]?.path ?? null)
      : null,
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
  if (remotes.status === "timed_out") return processFailure(remotes);
  if (remotes.status === "failed" && remotes.exitCode !== 1) {
    return processFailure(remotes);
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
  if (branch.status === "timed_out") return processFailure(branch);
  const head = await git(["rev-parse", "--verify", "HEAD"]);
  if (head.status === "timed_out") return processFailure(head);
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

export async function inspectRepository(
  input: { readonly path: string },
  options: GitCallOptions = {},
): Promise<GitInspectResult> {
  const path = absoluteGitPath(input.path);
  if ("status" in path) return path;
  return withGit(
    path.path,
    {
      timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      signal: options.signal,
    },
    inspectWithin,
  );
}
