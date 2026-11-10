import {
  GIT_INSPECT_METHOD,
  GIT_LOCATE_METHOD,
  GIT_STATE_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  isIntegerValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type GitFailure,
  type GitInspectResult,
  type GitLocateResult,
  type GitStateResult,
  type GitWorktreeAddResult,
  type GitWorktreeEntry,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
  type NativeDisplayOptions,
  type SerializableRecord,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  addWorktree,
  invalidInput,
  inspectRepository,
  listWorktrees,
  locateRepository,
  removeWorktree,
  stateRepository,
} from "@workspace/git-executor";
import type { OperationContext } from "./dispatch-types";
import { MachineRequestError } from "./errors";
import { isInsideRoots, rewriteRootPrefixes } from "./locators";
import {
  optionalString,
  optionalInteger,
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

/** The outermost registered root that holds `path`: the walk and the
 *  repository checks stop there, so nothing above the roots is read. */
function outermostRoot(
  context: OperationContext,
  path: string,
): string | undefined {
  return context.guard.roots
    .filter((root) => isInsideRoots([root], path))
    .sort((first, second) => first.length - second.length)[0];
}

export async function locateOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitLocateResult> {
  const source = paramRecord(params, GIT_LOCATE_METHOD);
  refuseUnknownKeys(source, GIT_LOCATE_METHOD, ["envelope", "options", "path"]);
  const options = requireDisplayOptions(source, GIT_LOCATE_METHOD);

  const guarded = await context.guard.resolvePath(
    requireString(source, "path", GIT_LOCATE_METHOD),
  );

  const result = await locateRepository(
    {
      path: guarded.canonical,
      ceiling: outermostRoot(context, guarded.canonical),
    },
    { signal: context.signal },
  );

  if (result.status === "error") return renderFailure(result, context, options);

  return {
    ...result,
    gitEntry: resultLocator(options, context, result.gitEntry),
  };
}

const MAXIMUM_STATE_LIMIT = 1000;

function readStateBounds(
  source: SerializableRecord,
):
  | { readonly limit: number; readonly submodules: "skip" | "check" }
  | GitFailure {
  const { limit, submodules } = source;

  if (!isIntegerValue(limit) || limit < 0 || limit > MAXIMUM_STATE_LIMIT) {
    return invalidInput(
      `limit must be a whole number from 0 to ${String(MAXIMUM_STATE_LIMIT)}`,
    );
  }

  if (submodules !== "skip" && submodules !== "check") {
    return invalidInput('submodules must be "skip" or "check"');
  }

  return { limit, submodules };
}

export async function stateOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<GitStateResult> {
  const source = paramRecord(params, GIT_STATE_METHOD);
  refuseUnknownKeys(source, GIT_STATE_METHOD, [
    "envelope",
    "options",
    "path",
    "gitEntry",
    "limit",
    "submodules",
    "timeoutMs",
  ]);
  const options = requireDisplayOptions(source, GIT_STATE_METHOD);
  const path = requireString(source, "path", GIT_STATE_METHOD);
  const gitEntry = requireString(source, "gitEntry", GIT_STATE_METHOD);
  const bounds = readStateBounds(source);

  if ("status" in bounds) return bounds;
  const timeoutMs = optionalInteger(source, "timeoutMs", GIT_STATE_METHOD, 1);
  const guarded = await context.guard.resolvePath(path);
  const entry = await context.guard.resolvePath(gitEntry);

  const result = await stateRepository(
    {
      path: guarded.canonical,
      gitEntry: entry.path,
      limit: bounds.limit,
      submodules: bounds.submodules,
      ceiling: outermostRoot(context, guarded.canonical),
      confine: (candidate) => isInsideRoots(context.guard.roots, candidate),
    },
    { signal: context.signal, timeoutMs },
  );

  if (result.status === "error") return renderFailure(result, context, options);

  return {
    ...result,
    toplevel: resultLocator(options, context, result.toplevel),
  };
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
