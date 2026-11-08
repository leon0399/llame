export { DEFAULT_GIT_TIMEOUT_MS, invalidInput } from "./invocation";
export { inspectRepository } from "./inspect";
export { locateRepository } from "./locate";
export type { LocateInput } from "./locate";
export { stateRepository } from "./state";
export type { StateInput } from "./state";
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
  GitLocateResult,
  GitLocateSuccess,
  GitStateResult,
  GitStateSuccess,
  GitWorktreeAddResult,
  GitWorktreeListResult,
  GitWorktreeRemoveResult,
} from "@workspace/machine-protocol";
