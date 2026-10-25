export { inspectRepository } from "./inspect";
export { statusRepository } from "./status";
export type { WorktreeAddInput } from "./worktrees";
export {
  addWorktree,
  baseReference,
  branchName,
  listWorktrees,
  removeWorktree,
  WORKTREE_ADD_TIMEOUT_MS,
} from "./worktrees";
/*
 * The result shapes are the wire protocol's own: one declaration serves the
 * daemon's answers and the hub's local executor, so the two cannot drift.
 */
export type {
  GitFailure,
  GitInspectResult,
  GitInspectSuccess,
  GitStatusResult,
  GitWorktreeAddResult,
  GitWorktreeListResult,
  GitWorktreeRemoveResult,
} from "@workspace/machine-protocol";
