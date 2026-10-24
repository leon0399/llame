/**
 * The typed result of one git operation, and the bound its standard error
 * carries.
 *
 * A git call never returns raw porcelain text or a command line to its caller:
 * the result is either the fields the call promises or a typed failure whose
 * standard error is bounded and has had any URL credentials removed.
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

/** Options every operation accepts; the timeout is the whole call's budget. */
export type GitOperationOptions = {
  readonly timeoutMs?: number;
};
