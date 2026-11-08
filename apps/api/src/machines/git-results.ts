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
  type GitLocateResult,
  type GitStateResult,
  type GitStateSuccess,
  type GitWorktreeAddResult,
  type GitWorktreeEntry,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
  type JsonValue,
  type SerializableValue,
} from '@workspace/machine-protocol';

import { formatMachineLocator, MACHINE_SCHEME } from './machine-locator';
import { isCount, isFlag, isText, isTextList } from './machine-results';

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

const STDERR_FAILURE_TYPES = [
  'not_a_repository',
  'timed_out',
  'git_failed',
  'no_repository_in_root',
  'root_missing',
  'git_entry_changed',
  'outside_registered_root',
  'output_bound',
] as const;

function isStderrFailureType(
  value: SerializableValue,
): value is (typeof STDERR_FAILURE_TYPES)[number] {
  return STDERR_FAILURE_TYPES.some((type) => type === value);
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
  if (!isStderrFailureType(type)) return undefined;
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

/** A `git.locate` answer: the entry as a locator and its kind, or a failure. */
export function readGitLocateResult(
  value: JsonValue,
  machine: string,
): GitLocateResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const gitEntry = readLocatorPath(machine, value['gitEntry']);
  const kind = value['kind'];
  if (gitEntry === undefined || (kind !== 'directory' && kind !== 'file'))
    return undefined;
  return { status: 'ok', gitEntry: gitEntry.value, kind };
}

type StateUpstream = NonNullable<GitStateSuccess['upstream']>;
type StateOperation = NonNullable<GitStateSuccess['operation']>;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

const STATE_OPERATION_KINDS = [
  'merge',
  'rebase',
  'am',
  'cherry-pick',
  'revert',
  'bisect',
] as const;

/** A count that is absent or null, as `null`; anything else unusable fails. */
function readNullableCount(
  value: SerializableValue,
): { readonly value: number | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  return isCount(value) ? { value } : undefined;
}

function readStateUpstream(
  value: SerializableValue,
): { readonly value: StateUpstream | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  if (!isSerializableRecord(value)) return undefined;
  const { name, gone } = value;
  const ahead = readNullableCount(value['ahead']);
  const behind = readNullableCount(value['behind']);
  const updatedAt = readOptionalText(value['updatedAt']);
  if (
    !isText(name) ||
    !isFlag(gone) ||
    ahead === undefined ||
    behind === undefined ||
    updatedAt === undefined
  )
    return undefined;
  return {
    value: {
      name,
      gone,
      ahead: ahead.value,
      behind: behind.value,
      updatedAt: updatedAt.value,
    },
  };
}

function readStateOperation(
  value: SerializableValue,
): { readonly value: StateOperation | null } | undefined {
  if (value === null || value === undefined) return { value: null };
  if (!isSerializableRecord(value)) return undefined;
  const kind = STATE_OPERATION_KINDS.find((known) => known === value['kind']);
  const { step, total } = value;
  if (kind === undefined) return undefined;
  if (step !== undefined && !isCount(step)) return undefined;
  if (total !== undefined && !isCount(total)) return undefined;
  const operation: Writable<StateOperation> = { kind };
  if (step !== undefined) operation.step = step;
  if (total !== undefined) operation.total = total;
  return { value: operation };
}

function readStateCounts(
  value: SerializableValue,
): GitStateSuccess['counts'] | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { staged, unstaged, untracked, conflicted } = value;
  if (
    !isCount(staged) ||
    !isCount(unstaged) ||
    !isCount(untracked) ||
    !isCount(conflicted)
  )
    return undefined;
  return { staged, unstaged, untracked, conflicted };
}

function readStateEntries(
  value: SerializableValue,
): GitStateSuccess['entries'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: Array<GitStateSuccess['entries'][number]> = [];
  for (const entry of value) {
    if (!isSerializableRecord(entry)) return undefined;
    const { xy, path, from } = entry;
    if (!isText(xy) || !isText(path)) return undefined;
    if (from !== undefined && !isText(from)) return undefined;
    entries.push(from === undefined ? { xy, path } : { xy, path, from });
  }
  return entries;
}

function readStateCommits(
  value: SerializableValue,
): GitStateSuccess['commits'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const commits: Array<GitStateSuccess['commits'][number]> = [];
  for (const commit of value) {
    if (!isSerializableRecord(commit)) return undefined;
    const { short, subject } = commit;
    if (!isText(short) || !isText(subject)) return undefined;
    commits.push({ short, subject });
  }
  return commits;
}

type StateHead = Pick<
  GitStateSuccess,
  'branch' | 'detached' | 'head' | 'upstream' | 'operation'
>;
type StateChanges = Pick<
  GitStateSuccess,
  'counts' | 'entries' | 'omitted' | 'submodules' | 'commits' | 'remotes'
>;

function readStateHead(
  value: Readonly<Record<string, SerializableValue>>,
): StateHead | undefined {
  const branch = readOptionalText(value['branch']);
  const head = readOptionalText(value['head']);
  const upstream = readStateUpstream(value['upstream']);
  const operation = readStateOperation(value['operation']);
  const { detached } = value;
  if (
    branch === undefined ||
    head === undefined ||
    upstream === undefined ||
    operation === undefined ||
    !isFlag(detached)
  )
    return undefined;
  return {
    branch: branch.value,
    detached,
    head: head.value,
    upstream: upstream.value,
    operation: operation.value,
  };
}

function readStateChanges(
  value: Readonly<Record<string, SerializableValue>>,
): StateChanges | undefined {
  const counts = readStateCounts(value['counts']);
  const entries = readStateEntries(value['entries']);
  const submodules = value['submodules'];
  const commits = readStateCommits(value['commits']);
  const remotes = readGitRemotes(value['remotes']);
  const { omitted } = value;
  if (
    counts === undefined ||
    entries === undefined ||
    !isCount(omitted) ||
    !isTextList(submodules) ||
    commits === undefined ||
    remotes === undefined
  )
    return undefined;
  return { counts, entries, omitted, submodules, commits, remotes };
}

/** A `git.state` answer: every field rebuilt, the toplevel as a locator. */
export function readGitStateResult(
  value: JsonValue,
  machine: string,
): GitStateResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const toplevel = readLocatorPath(machine, value['toplevel']);
  const head = readStateHead(value);
  const changes = readStateChanges(value);
  const { rootRelative } = value;
  if (
    toplevel === undefined ||
    !isText(rootRelative) ||
    head === undefined ||
    changes === undefined
  )
    return undefined;
  return {
    status: 'ok',
    toplevel: toplevel.value,
    rootRelative,
    ...head,
    ...changes,
  };
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

/** A `git.worktreeList` answer: each worktree as a locator, or a typed failure. */
export function readGitWorktreeListResult(
  value: JsonValue,
  machine: string,
): GitWorktreeListResult | undefined {
  const failure = readGitFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'ok')
    return undefined;
  const entries = value['worktrees'];
  if (!Array.isArray(entries)) return undefined;
  const worktrees: Array<GitWorktreeEntry> = [];
  for (const entry of entries) {
    if (!isSerializableRecord(entry)) return undefined;
    const path = readLocatorPath(machine, entry['path']);
    const branch = readOptionalText(entry['branch']);
    const head = readOptionalText(entry['head']);
    const locked = entry['locked'];
    const prunable = entry['prunable'];
    if (
      path === undefined ||
      branch === undefined ||
      head === undefined ||
      !isFlag(locked) ||
      !isFlag(prunable)
    )
      return undefined;
    worktrees.push({
      path: path.value,
      branch: branch.value,
      head: head.value,
      locked,
      prunable,
    });
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
