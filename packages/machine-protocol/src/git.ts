/*
 * The typed git surface every executor answers (openspec `repositories` design
 * D4). These methods are additive to the protocol: `PROTOCOL_VERSION` stays 1,
 * and the handshake's `methods` list names the git methods a daemon answers. A
 * daemon that predates them omits the list, and a hub refuses a git call on it
 * as `machine_update_required` before any request.
 */

export const GIT_INSPECT_METHOD = "git.inspect";
export const GIT_WORKTREE_ADD_METHOD = "git.worktreeAdd";
export const GIT_WORKTREE_LIST_METHOD = "git.worktreeList";
export const GIT_WORKTREE_REMOVE_METHOD = "git.worktreeRemove";
export const GIT_STATUS_METHOD = "git.status";

/** Every git method, in the order the handshake lists them. */
export const GIT_METHODS = [
  GIT_INSPECT_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  GIT_STATUS_METHOD,
] as const;

export type GitMethod = (typeof GIT_METHODS)[number];

export function isGitMethod(value: string): value is GitMethod {
  return GIT_METHODS.some((method) => method === value);
}
