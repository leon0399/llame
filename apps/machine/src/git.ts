import {
  GIT_INSPECT_METHOD,
  GIT_STATUS_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  PATH_NOT_REGISTERED_MESSAGE,
  type GitFailure,
  type GitInspectResult,
  type GitStatusResult,
  type GitWorktreeAddResult,
  type GitWorktreeEntry,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
  type NativeDisplayOptions,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  removeWorktree,
  statusRepository,
} from "@workspace/git-executor";
import type { OperationContext } from "./dispatch-types";
import { MachineRequestError } from "./errors";
import { isInsideRoots, rewriteRootPrefixes } from "./locators";
import {
  optionalString,
  paramRecord,
  refuseUnknownKeys,
  requireDisplayOptions,
  requireString,
} from "./params";

/*
 * The daemon's typed git surface (openspec `remote-machines` "Machine daemons
 * answer typed git methods").
 *
 * Every path is decided by the root guard before any git call, so a caller
 * cannot make the daemon probe an address no registered root bounds, and a
 * worktree directory that does not exist yet is decided through its nearest
 * existing ancestor. The operations themselves live in `@workspace/git-executor`,
 * shared with the hub's local executor, so both sides run one argv, one
 * environment, and one timeout.
 *
 * Every path a result carries leaves as a Machine locator, and each
 * registered-root prefix in a failure's standard error is rewritten to that
 * locator form, so no host path for a registered root reaches the hub.
 */

/**
 * One result path in the locator form. A path outside every registered root is
 * refused instead: a toplevel above the roots (a tracked home directory, say)
 * discloses host layout the root guard hides, and the hub could not address it
 * back.
 */
function resultLocator(
  options: NativeDisplayOptions,
  context: OperationContext,
  path: string,
): string {
  if (!isInsideRoots(context.guard.roots, path)) {
    throw new MachineRequestError(
      "path_not_registered",
      PATH_NOT_REGISTERED_MESSAGE,
    );
  }
  return `${options.displayPrefix}${path}`;
}

function renderFailure(
  failure: GitFailure,
  context: OperationContext,
  options: NativeDisplayOptions,
): GitFailure {
  if (failure.type === "invalid_input") return failure;
  return {
    ...failure,
    stderr: rewriteRootPrefixes(
      failure.stderr,
      context.guard.roots,
      options.displayPrefix,
    ),
  };
}

export async function inspectOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitInspectResult> {
  const source = paramRecord(params, GIT_INSPECT_METHOD);
  refuseUnknownKeys(source, GIT_INSPECT_METHOD, [
    "envelope",
    "options",
    "path",
  ]);
  const options = requireDisplayOptions(source, GIT_INSPECT_METHOD);
  const guarded = await context.guard.resolvePath(
    requireString(source, "path", GIT_INSPECT_METHOD),
  );
  const result = await inspectRepository(
    { path: guarded.canonical },
    { signal: context.signal },
  );
  if (result.status === "error") return renderFailure(result, context, options);
  return {
    ...result,
    toplevel: resultLocator(options, context, result.toplevel),
    commonDir: resultLocator(options, context, result.commonDir),
    mainWorktree:
      result.mainWorktree === null
        ? null
        : resultLocator(options, context, result.mainWorktree),
  };
}

export async function statusOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitStatusResult> {
  const source = paramRecord(params, GIT_STATUS_METHOD);
  refuseUnknownKeys(source, GIT_STATUS_METHOD, ["envelope", "options", "path"]);
  const options = requireDisplayOptions(source, GIT_STATUS_METHOD);
  const guarded = await context.guard.resolvePath(
    requireString(source, "path", GIT_STATUS_METHOD),
  );
  const result = await statusRepository(
    { path: guarded.canonical },
    { signal: context.signal },
  );
  return result.status === "error"
    ? renderFailure(result, context, options)
    : result;
}

export async function worktreeAddOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitWorktreeAddResult> {
  const source = paramRecord(params, GIT_WORKTREE_ADD_METHOD);
  refuseUnknownKeys(source, GIT_WORKTREE_ADD_METHOD, [
    "envelope",
    "options",
    "source",
    "branch",
    "baseRef",
    "directory",
  ]);
  const options = requireDisplayOptions(source, GIT_WORKTREE_ADD_METHOD);
  // Both paths are decided before git starts: the source clone and the
  // directory the worktree would occupy.
  const from = await context.guard.resolvePath(
    requireString(source, "source", GIT_WORKTREE_ADD_METHOD),
  );
  const directory = await context.guard.resolvePath(
    requireString(source, "directory", GIT_WORKTREE_ADD_METHOD),
  );
  const result = await addWorktree(
    {
      source: from.canonical,
      branch: requireString(source, "branch", GIT_WORKTREE_ADD_METHOD),
      baseRef: optionalString(source, "baseRef", GIT_WORKTREE_ADD_METHOD),
      directory: directory.canonical,
    },
    { signal: context.signal },
  );
  if (result.status === "error") return renderFailure(result, context, options);
  return { ...result, path: resultLocator(options, context, result.path) };
}

export async function worktreeListOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitWorktreeListResult> {
  const source = paramRecord(params, GIT_WORKTREE_LIST_METHOD);
  refuseUnknownKeys(source, GIT_WORKTREE_LIST_METHOD, [
    "envelope",
    "options",
    "source",
  ]);
  const options = requireDisplayOptions(source, GIT_WORKTREE_LIST_METHOD);
  const guarded = await context.guard.resolvePath(
    requireString(source, "source", GIT_WORKTREE_LIST_METHOD),
  );
  const result = await listWorktrees(
    { path: guarded.canonical },
    { signal: context.signal },
  );
  if (result.status === "error") return renderFailure(result, context, options);
  return {
    status: "ok",
    worktrees: result.worktrees.map((entry): GitWorktreeEntry => ({
      ...entry,
      path: resultLocator(options, context, entry.path),
    })),
  };
}

export async function worktreeRemoveOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitWorktreeRemoveResult> {
  const source = paramRecord(params, GIT_WORKTREE_REMOVE_METHOD);
  refuseUnknownKeys(source, GIT_WORKTREE_REMOVE_METHOD, [
    "envelope",
    "options",
    "path",
  ]);
  const options = requireDisplayOptions(source, GIT_WORKTREE_REMOVE_METHOD);
  const guarded = await context.guard.resolvePath(
    requireString(source, "path", GIT_WORKTREE_REMOVE_METHOD),
  );
  const result = await removeWorktree(
    { path: guarded.canonical },
    { signal: context.signal },
  );
  return result.status === "error"
    ? renderFailure(result, context, options)
    : result;
}
