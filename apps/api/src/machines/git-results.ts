/**
 * Untrusted-input narrowing for the typed git results. A Machine is not a
 * trusted peer, so every field a hub-side caller reads is rebuilt here; an
 * unusable answer narrows to `undefined` instead of a wrong value.
 */

import {
  isSerializableRecord,
  type GitFailure,
  type GitInspectResult,
  type GitRepositoryRemote,
  type GitStatusResult,
  type GitWorktreeAddResult,
  type GitWorktreeEntry,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
  type JsonValue,
  type SerializableValue,
} from '@workspace/machine-protocol';

import { isCount, isFlag, isText, isUntrustedList } from './machine-results';

/** A nullable path field of a git result: a locator, or `null`. */
function readOptionalText(
  value: SerializableValue,
): { readonly value: string | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  return isText(value) ? { value } : undefined;
}

/** A git refusal or failure, as a `git.*` method answers it. */
export function readGitFailure(value: JsonValue): GitFailure | undefined {
  if (!isSerializableRecord(value) || value['status'] !== 'error')
    return undefined;
  const type = value['type'];
  if (type === 'invalid_input') {
    const message = value['message'];
    return isText(message)
      ? { status: 'error', type: 'invalid_input', message }
      : undefined;
  }
  if (
    type !== 'not_a_repository' &&
    type !== 'timed_out' &&
    type !== 'git_failed'
  )
    return undefined;
  const stderr = value['stderr'];
  return isText(stderr) ? { status: 'error', type, stderr } : undefined;
}

function readGitRemotes(
  value: SerializableValue,
): ReadonlyArray<GitRepositoryRemote> | undefined {
  if (!Array.isArray(value)) return undefined;
  const remotes: Array<GitRepositoryRemote> = [];
  for (const entry of value) {
    if (!isSerializableRecord(entry)) return undefined;
    const name = entry['name'];
    const url = entry['url'];
    if (!isText(name) || !isText(url)) return undefined;
    remotes.push({ name, url });
  }
  return remotes;
}

/** A `git.inspect` answer: locators on a Machine, or a typed failure. */
export function readGitInspectResult(
  value: JsonValue,
): GitInspectResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const { toplevel, commonDir, linked, remotes } = value;
  const mainWorktree = readOptionalText(value['mainWorktree']);
  const branch = readOptionalText(value['branch']);
  const head = readOptionalText(value['head']);
  const repositoryRemotes = readGitRemotes(remotes ?? null);
  if (
    !isText(toplevel) ||
    !isText(commonDir) ||
    !isFlag(linked) ||
    mainWorktree === undefined ||
    branch === undefined ||
    head === undefined ||
    repositoryRemotes === undefined
  )
    return undefined;
  return {
    status: 'ok',
    toplevel,
    commonDir,
    linked,
    mainWorktree: mainWorktree.value,
    remotes: repositoryRemotes,
    branch: branch.value,
    head: head.value,
  };
}

/** A `git.status` answer: dirty, ahead, upstream, head, or a typed failure. */
export function readGitStatusResult(
  value: JsonValue,
): GitStatusResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const { dirty, ahead, upstream } = value;
  const head = readOptionalText(value['head']);
  if (!isFlag(dirty) || !isCount(ahead) || head === undefined) return undefined;
  if (upstream !== undefined && upstream !== null && !isText(upstream))
    return undefined;
  const status: GitStatusResult = {
    status: 'ok',
    dirty,
    ahead,
    head: head.value,
  };
  return isText(upstream) ? { ...status, upstream } : status;
}

/** A `git.worktreeAdd` answer: the created worktree, or a typed failure. */
export function readGitWorktreeAddResult(
  value: JsonValue,
): GitWorktreeAddResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const { path, branch, head } = value;
  if (!isText(path) || !isText(branch) || !isText(head)) return undefined;
  return { status: 'ok', path, branch, head };
}

function readWorktreeEntry(
  value: SerializableValue,
): GitWorktreeEntry | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { path, locked, prunable } = value;
  const branch = readOptionalText(value['branch']);
  const head = readOptionalText(value['head']);
  if (
    !isText(path) ||
    !isFlag(locked) ||
    !isFlag(prunable) ||
    branch === undefined ||
    head === undefined
  )
    return undefined;
  return { path, branch: branch.value, head: head.value, locked, prunable };
}

/** A `git.worktreeList` answer: each worktree, or a typed failure. */
export function readGitWorktreeListResult(
  value: JsonValue,
): GitWorktreeListResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const listed = value['worktrees'] ?? null;
  if (!isUntrustedList(listed)) return undefined;
  const worktrees: Array<GitWorktreeEntry> = [];
  for (const entry of listed) {
    const parsed = readWorktreeEntry(entry);
    if (parsed === undefined) return undefined;
    worktrees.push(parsed);
  }
  return { status: 'ok', worktrees };
}

/** A `git.worktreeRemove` answer: success, or a typed failure. */
export function readGitWorktreeRemoveResult(
  value: JsonValue,
): GitWorktreeRemoveResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  return isSerializableRecord(value) && value['status'] === 'ok'
    ? { status: 'ok' }
    : undefined;
}
