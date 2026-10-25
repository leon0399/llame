/*
 * The typed git refusal both executors raise.
 *
 * It lives apart from `ExecutorGit` on purpose: the tool-side entry path maps
 * these codes onto tool observations, and importing the Nest service would drag
 * the instance configuration and its loader into the tool module graph — a cycle
 * that leaves the tool registry partially initialized.
 */

/**
 * The codes this surface fails with. A checkout route answers each with the
 * status `repositories/failure.ts` maps it to; `path_not_registered` is the
 * daemon's own refusal of an address, which registration answers as
 * `permission_denied` and worktree entry reports under its own name.
 */
export type ExecutorGitErrorCode =
  | 'invalid_path'
  | 'not_a_directory'
  | 'executor_unavailable'
  | 'machine_unavailable'
  | 'machine_update_required'
  | 'path_not_registered'
  | 'permission_denied'
  | 'git_failed';

export class ExecutorGitError extends Error {
  constructor(
    readonly code: ExecutorGitErrorCode,
    message: string,
    /**
     * The request reached the link before the session ended, so a mutation's
     * effect is unknown rather than absent. Every read leaves it false.
     */
    readonly sent = false,
  ) {
    super(message);
    this.name = 'ExecutorGitError';
  }
}
