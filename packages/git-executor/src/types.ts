/*
 * What the five operations answer, exactly as `@workspace/machine-protocol`
 * declares the same shapes for the wire: the daemon renders every path as a
 * locator before it answers, and the hub's local executor answers the same
 * fields with absolute host paths.
 */

/** One configured remote of a repository. */
export type GitRepositoryRemote = {
  readonly name: string;
  readonly url: string;
};

/**
 * A refused or failed call. `invalid_input` is refused before git starts;
 * every other type comes from a started process, and carries the bounded,
 * redacted standard error git wrote.
 */
export type GitFailure =
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

/** Everything registration, adoption, and removal need from one inspection. */
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

export type GitInspectResult = GitInspectSuccess | GitFailure;

/** The working tree's state, and its place against its upstream. */
export type GitStatusSuccess = {
  readonly status: "ok";
  readonly dirty: boolean;
  /** Commits the branch is ahead of its upstream; zero without an upstream. */
  readonly ahead: number;
  /** The upstream ref, absent when the branch tracks none. */
  readonly upstream?: string;
  /** `null` on an unborn branch, which has no commit yet. */
  readonly head: string | null;
};

export type GitStatusResult = GitStatusSuccess | GitFailure;

/** One registered worktree of a repository. */
export type GitWorktreeEntry = {
  readonly path: string;
  /** `null` on a detached worktree. */
  readonly branch: string | null;
  readonly head: string | null;
  readonly locked: boolean;
  readonly prunable: boolean;
};

/** The worktree `git.worktreeAdd` created: where, on which branch, at which
 *  commit. */
export type GitWorktreeAddSuccess = {
  readonly status: "ok";
  readonly path: string;
  readonly branch: string;
  readonly head: string;
};

export type GitWorktreeAddResult = GitWorktreeAddSuccess | GitFailure;

export type GitWorktreeListResult =
  | {
      readonly status: "ok";
      readonly worktrees: ReadonlyArray<GitWorktreeEntry>;
    }
  | GitFailure;

export type GitWorktreeRemoveResult = { readonly status: "ok" } | GitFailure;
