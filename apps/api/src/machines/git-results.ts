/**
 * Untrusted-input narrowing for the typed git results. A Machine is not a
 * trusted peer, so every field a hub-side caller reads is rebuilt here; an
 * unusable answer narrows to `undefined` instead of a wrong value.
 *
 * Every path field is rebuilt as the canonical Machine locator, not copied: the
 * daemon answers its display prefix plus the host path, and only
 * `formatMachineLocator` decides where the reserved characters (`%`, `#`, `?`,
 * `\`, a selector colon) go.
 */

import {
  isSerializableRecord,
  type GitFailure,
  type GitInspectResult,
  type GitRepositoryRemote,
  type GitStatusResult,
  type GitWorktreeAddResult,
  type GitWorktreeRemoveResult,
  type JsonValue,
  type SerializableValue,
} from '@workspace/machine-protocol';

import { formatMachineLocator, MACHINE_SCHEME } from './machine-locator';
import { isCount, isFlag, isText } from './machine-results';

/** One path field of a git result, as the canonical locator of this Machine. */
function readLocatorPath(
  machine: string,
  value: SerializableValue,
): { readonly value: string } | undefined {
  if (!isText(value)) return undefined;
  const prefix = `${MACHINE_SCHEME}://${machine}`;
  if (!value.startsWith(`${prefix}/`)) return undefined;
  const locator = formatMachineLocator(machine, value.slice(prefix.length));
  return locator === undefined ? undefined : { value: locator };
}

/** A nullable path field of a git result: a locator, or `null`. */
function readOptionalLocator(
  machine: string,
  value: SerializableValue,
): { readonly value: string | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  return readLocatorPath(machine, value);
}

/** A nullable text field that is not a path, such as a branch or a commit. */
function readOptionalText(
  value: SerializableValue,
): { readonly value: string | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  return isText(value) ? { value } : undefined;
}

/** A git refusal or failure, as a `git.*` method answers it. */
function readGitFailure(value: JsonValue): GitFailure | undefined {
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
  machine: string,
): GitInspectResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const toplevel = readLocatorPath(machine, value['toplevel']);
  const commonDir = readLocatorPath(machine, value['commonDir']);
  const mainWorktree = readOptionalLocator(machine, value['mainWorktree']);
  const branch = readOptionalText(value['branch']);
  const head = readOptionalText(value['head']);
  const linked = value['linked'];
  const repositoryRemotes = readGitRemotes(value['remotes'] ?? null);
  if (
    toplevel === undefined ||
    commonDir === undefined ||
    !isFlag(linked) ||
    mainWorktree === undefined ||
    branch === undefined ||
    head === undefined ||
    repositoryRemotes === undefined
  )
    return undefined;
  return {
    status: 'ok',
    toplevel: toplevel.value,
    commonDir: commonDir.value,
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
  machine: string,
): GitWorktreeAddResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const path = readLocatorPath(machine, value['path']);
  const { branch, head } = value;
  if (path === undefined || !isText(branch) || !isText(head)) return undefined;
  return { status: 'ok', path: path.value, branch, head };
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
