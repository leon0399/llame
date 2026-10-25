import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { GitFailure } from "@workspace/machine-protocol";

import { redactCredentials, runGitProcess, type GitProcessResult } from "./run";

/*
 * One git session: a working directory, a deadline every subcommand of the
 * session shares, and one empty hooks directory so the repository's own hooks
 * can never be found. Nothing here goes through a shell, so a path or a ref
 * holding `;`, `$()`, or whitespace stays one argument.
 */

/** The budget of one read-only call, absent a shorter caller deadline. */
export const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/** One git invocation of a session, argv only. */
export type GitRunner = (
  args: ReadonlyArray<string>,
) => Promise<GitProcessResult>;

/** The deadline and the cancellation one operation accepts. */
export type GitCallOptions = {
  readonly timeoutMs?: number;
  /** Aborts every subcommand of the call; a cancelled hub request sets it. */
  readonly signal?: AbortSignal;
};

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

/** The refusal a caller value earns before git starts. */
export function invalidInput(
  message: string,
): Extract<GitFailure, { readonly type: "invalid_input" }> {
  return { status: "error", type: "invalid_input", message };
}

/** The refusal of a path that git must never receive as an argv element. */
export function absoluteGitPath(
  value: string,
):
  | { readonly path: string }
  | Extract<GitFailure, { readonly type: "invalid_input" }> {
  if (value.includes("\0")) {
    return invalidInput("A git path must not contain a NUL byte.");
  }
  return isAbsolute(value)
    ? { path: value }
    : invalidInput("A git path must be absolute.");
}

/** Git's own wording for "this path holds no repository", plus the `-C`
 *  failures that mean the same thing to a caller. */
const NOT_A_REPOSITORY =
  /not a git repository|must be run in a work tree|not a work tree|cannot change to|cannot chdir/iu;

/** The typed failure of a started git process, with the bounded, redacted
 *  standard error it wrote. */
export function processFailure(
  result: Exclude<GitProcessResult, { readonly status: "ok" }>,
): GitFailure {
  const stderr = redactCredentials(result.stderr).trim();
  const type =
    result.status === "timed_out"
      ? "timed_out"
      : NOT_A_REPOSITORY.test(stderr)
        ? "not_a_repository"
        : "git_failed";
  return { status: "error", type, stderr };
}

/**
 * Run `work` in one git session rooted at `directory`: one deadline, so a hung
 * git cannot multiply the timeout by the number of subcommands the operation
 * makes, and one throwaway hooks directory, removed afterwards. The caller's
 * signal reaches every subcommand, so a cancelled call ends git too.
 */
export async function withGit<T>(
  directory: string,
  options: GitCallOptions & { readonly timeoutMs: number },
  work: (git: GitRunner) => Promise<T>,
): Promise<T> {
  const endsAt = Date.now() + options.timeoutMs;
  const hooksDirectory = await mkdtemp(join(tmpdir(), "llame-git-hooks-"));
  const prefix = gitPrefixArguments(hooksDirectory, directory);
  const git: GitRunner = (args) =>
    runGitProcess([...prefix, ...args], {
      timeoutMs: endsAt - Date.now(),
      signal: options.signal,
    });
  try {
    return await work(git);
  } finally {
    await rm(hooksDirectory, { recursive: true, force: true });
  }
}
