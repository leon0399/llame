/**
 * The shapes of one git observation (openspec `workspace-git-state`, design D6).
 *
 * `GitStateView` is the state after normalization and bounding: no raw remote
 * URL survives into it, because it is also the future `git` item payload and
 * the owner route body. It is NOT neutralized; the renderer neutralizes every
 * repository string at the moment it renders.
 */

export type GitAbsenceReason =
  | 'not_permitted'
  | 'timeout'
  | 'machine_unavailable'
  | 'machine_update_required'
  | 'executor_unavailable'
  | 'root_not_found'
  | 'too_many_changes'
  | 'no_repository_in_root'
  | 'outside_registered_root'
  | 'git_failed';

/** The closed list of absence labels; the line is `git state unavailable: <label>`. */
export const GIT_ABSENCE_LABELS: Readonly<Record<GitAbsenceReason, string>> = {
  not_permitted: 'not permitted',
  timeout: 'timeout',
  machine_unavailable: 'Machine unavailable',
  machine_update_required: 'Machine daemon update required',
  executor_unavailable: 'executor unavailable',
  root_not_found: 'Workspace root not found',
  too_many_changes: 'too many changes',
  no_repository_in_root: 'no repository inside the registered root',
  outside_registered_root: 'repository outside the registered root',
  git_failed: 'git failed',
};

export type GitStateView = {
  readonly toplevel: string;
  /** Posix, relative to `toplevel`; empty when the root is the toplevel. */
  readonly rootRelative: string;
  readonly branch: string | null;
  readonly detached: boolean;
  /** `null` on an unborn branch. */
  readonly head: { readonly short: string; readonly oid: string } | null;
  readonly upstream: {
    readonly name: string;
    readonly gone: boolean;
    readonly ahead: number | null;
    readonly behind: number | null;
    readonly updatedAt: string | null;
  } | null;
  readonly operation: {
    readonly kind: string;
    readonly step?: number;
    readonly total?: number;
  } | null;
  readonly counts: {
    readonly staged: number;
    readonly unstaged: number;
    readonly untracked: number;
    readonly conflicted: number;
  };
  readonly entries: ReadonlyArray<{
    readonly xy: string;
    readonly path: string;
    readonly from?: string;
  }>;
  readonly omitted: number;
  readonly submodules: ReadonlyArray<string>;
  readonly commits: ReadonlyArray<{
    readonly short: string;
    readonly subject: string;
  }>;
  /** Normalized values only; a remote without a host is `local`. */
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
  }>;
  readonly remotesOmitted: number;
};

export type GitObservation =
  | { readonly kind: 'state'; readonly view: GitStateView }
  | { readonly kind: 'not_a_repository' }
  | { readonly kind: 'unavailable'; readonly reason: GitAbsenceReason };
