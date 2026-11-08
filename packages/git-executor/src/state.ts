import { dirname, posix } from "node:path";

import {
  absoluteGitPath,
  DEFAULT_GIT_TIMEOUT_MS,
  processFailure,
  withGit,
  type GitCallOptions,
  type GitRunner,
} from "./invocation";
import { parseRemoteRecords } from "./inspect";
import { absoluteLocateInput, locateNearest } from "./locate";
import { detectOperation, repositoryDirectories } from "./repository-files";
import type { GitProcessResult } from "./run";
import {
  layoutPaths,
  parseCommits,
  parseStatus,
  parseSubmodulePaths,
  reflogTime,
  type ParsedStatus,
} from "./state-parse";
import type {
  GitFailure,
  GitStateResult,
  GitStateSuccess,
} from "@workspace/machine-protocol";

/*
 * `git.state`: one read-only observation of the repository whose `.git` entry
 * `git.locate` returned. It locates again and refuses a changed entry, checks
 * the repository's directories against `confine` before any git process
 * starts, then runs a fixed set of commands pinned to that entry inside one
 * deadline.
 */

export type StateInput = {
  readonly path: string;
  readonly gitEntry: string;
  readonly limit: number;
  readonly submodules: "skip" | "check";
  /** An absolute directory that holds `path`; the re-locate ends there. */
  readonly ceiling?: string;
  /** `false` for a path outside the registered roots. */
  readonly confine?: (path: string) => boolean;
};

type Step<T> = T | GitFailure;

const HEAD_MODULES = "HEAD:.gitmodules";

/** A failed call. An entry that git rejects as no repository is invalid, not
 *  absent: locate already found it. */
function failure(
  result: Exclude<GitProcessResult, { readonly status: "ok" }>,
): GitFailure {
  const failed = processFailure(result);
  return failed.status === "error" && failed.type === "not_a_repository"
    ? { ...failed, type: "git_failed" }
    : failed;
}

/** Exit 1 of `config --get-regexp` is "no match", not a failure. */
async function configValues(
  git: GitRunner,
  args: ReadonlyArray<string>,
): Promise<Step<string>> {
  const result = await git(["config", "--null", ...args]);
  if (result.status === "ok") return result.stdout;
  if (result.status === "failed" && result.exitCode === 1) return "";
  return failure(result);
}

async function submodulePaths(
  git: GitRunner,
  hasHead: boolean,
): Promise<Step<Array<string>>> {
  if (!hasHead) return [];
  const present = await git(["cat-file", "-e", HEAD_MODULES]);
  if (present.status === "timed_out") return failure(present);
  if (present.status === "failed") return [];
  const paths = await configValues(git, [
    "--blob",
    HEAD_MODULES,
    "--get-regexp",
    String.raw`^submodule\..*\.path$`,
  ]);
  return isFailure(paths) ? paths : parseSubmodulePaths(paths);
}

/** When the upstream ref last changed; skipped for a name git could read as
 *  an option. */
async function upstreamTime(
  git: GitRunner,
  name: string,
): Promise<Step<string | null>> {
  if (name.startsWith("-")) return null;
  const result = await git([
    "reflog",
    "show",
    "-1",
    "--date=unix",
    "--format=%gd",
    name,
  ]);
  return result.status === "ok" ? reflogTime(result.stdout) : failure(result);
}

async function upstreamState(
  git: GitRunner,
  parsed: ParsedStatus,
): Promise<Step<GitStateSuccess["upstream"]>> {
  if (parsed.upstream === null) return null;
  if (parsed.ab === null) {
    return {
      name: parsed.upstream,
      gone: true,
      ahead: null,
      behind: null,
      updatedAt: null,
    };
  }
  const updatedAt = await upstreamTime(git, parsed.upstream);
  if (isFailure(updatedAt)) return updatedAt;
  return {
    name: parsed.upstream,
    gone: false,
    ahead: parsed.ab.ahead,
    behind: parsed.ab.behind,
    updatedAt,
  };
}

async function recentCommits(
  git: GitRunner,
  hasHead: boolean,
): Promise<Step<GitStateSuccess["commits"]>> {
  if (!hasHead) return [];
  const log = await git([
    "log",
    "-5",
    "--no-show-signature",
    "--format=%h%x00%s%x00",
  ]);
  return log.status === "ok" ? parseCommits(log.stdout) : failure(log);
}

const OPERATION_PATHS = [
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
] as const;

async function operationInProgress(
  git: GitRunner,
): Promise<Step<GitStateSuccess["operation"]>> {
  const located = await git([
    "rev-parse",
    "--path-format=absolute",
    ...OPERATION_PATHS.flatMap((name) => ["--git-path", name]),
  ]);
  if (located.status !== "ok") return failure(located);
  const [
    mergeHead = "",
    rebaseMerge = "",
    rebaseApply = "",
    cherryPickHead = "",
    revertHead = "",
    bisectLog = "",
  ] = located.stdout.split("\n");
  return detectOperation({
    mergeHead,
    rebaseMerge,
    rebaseApply,
    cherryPickHead,
    revertHead,
    bisectLog,
  });
}

function isFailure<T>(value: Step<T>): value is GitFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "status" in value
  );
}

type Facts = {
  readonly commits: GitStateSuccess["commits"];
  readonly remotes: string;
  readonly modules: Array<string>;
  readonly upstream: GitStateSuccess["upstream"];
  readonly operation: GitStateSuccess["operation"];
};

/** The commands that follow `status`, which every one of them reads from. */
async function gatherFacts(
  git: GitRunner,
  parsed: ParsedStatus,
): Promise<Step<Facts>> {
  const hasHead = parsed.head !== null;
  const commits = await recentCommits(git, hasHead);
  if (isFailure(commits)) return commits;
  const remotes = await configValues(git, [
    "--get-regexp",
    String.raw`^remote\..*\.url$`,
  ]);
  if (isFailure(remotes)) return remotes;
  const modules = await submodulePaths(git, hasHead);
  if (isFailure(modules)) return modules;
  const upstream = await upstreamState(git, parsed);
  if (isFailure(upstream)) return upstream;
  const operation = await operationInProgress(git);
  if (isFailure(operation)) return operation;
  return { commits, remotes, modules, upstream, operation };
}

async function observe(
  git: GitRunner,
  input: StateInput,
  toplevel: string,
): Promise<GitStateResult> {
  const status = await git([
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=normal",
    `--ignore-submodules=${input.submodules === "check" ? "none" : "all"}`,
  ]);
  if (status.status !== "ok") return failure(status);
  if (status.truncated) {
    return { status: "error", type: "output_bound", stderr: "" };
  }
  const parsed = parseStatus(status.stdout);
  const facts = await gatherFacts(git, parsed);
  if (isFailure(facts)) return facts;

  const rootRelative = posix.relative(toplevel, input.path);
  return {
    status: "ok",
    toplevel,
    rootRelative,
    branch: parsed.branch,
    detached: parsed.detached,
    head: parsed.head,
    upstream: facts.upstream,
    operation: facts.operation,
    counts: parsed.counts,
    ...layoutPaths(rootRelative, parsed.entries, facts.modules, input.limit),
    commits: facts.commits,
    remotes: parseRemoteRecords(facts.remotes),
  };
}

export async function stateRepository(
  input: StateInput,
  options: GitCallOptions = {},
): Promise<GitStateResult> {
  const checked = absoluteLocateInput(input);
  if ("status" in checked) return checked;
  const entry = absoluteGitPath(input.gitEntry);
  if ("status" in entry) return entry;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;

  const located = await locateNearest(checked, {
    endsAt: Date.now() + timeoutMs,
    signal: options.signal,
  });
  if (located.status === "error") return located;
  if (located.gitEntry !== entry.path) {
    return { status: "error", type: "git_entry_changed", stderr: "" };
  }

  if (input.confine !== undefined) {
    const directories = await repositoryDirectories(
      located.gitEntry,
      located.kind,
    );
    if (directories === undefined) {
      return {
        status: "error",
        type: "git_failed",
        stderr: "The .git file does not name a git directory.",
      };
    }
    if (!directories.every(input.confine)) {
      return { status: "error", type: "outside_registered_root", stderr: "" };
    }
  }

  const toplevel = dirname(located.gitEntry);
  return withGit(
    toplevel,
    { timeoutMs, signal: options.signal, pinned: true },
    (git) => observe(git, { ...input, path: checked.path }, toplevel),
  );
}
