/** The budget of one read-only Git operation, absent a shorter caller deadline. */
export const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/** A worktree checkout writes every file and may outlast a read-only operation. */
export const WORKTREE_ADD_TIMEOUT_MS = 120_000;
