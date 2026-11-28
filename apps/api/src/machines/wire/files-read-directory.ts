import {
  isWalkFixedName,
  renderCollectedDirectoryParts,
  type ChildDir,
  type DirEntry,
} from '@workspace/native-file-tools';
import type { Entry, FsReadResult } from '@workspace/machine-protocol';
import { EntryKind } from '@workspace/machine-protocol';
import type {
  MachineRequestOptions,
  MachineSession,
} from '../machine-session.js';
import {
  failure,
  isNativeFailure,
  isNativeFailureType,
  MAX_TREE_ENTRIES,
  renderPath,
  rpc,
} from './files-common.js';

type DirectoryItems = { entries: Array<Entry>; total: number };

type DirectoryRequest = {
  path: string;
  prefix: string;
  reserveCodeUnits: number;
  options?: MachineRequestOptions;
};

type ChildDirectoryRequest = {
  path: string;
  entry: Entry;
  budget: number;
  options?: MachineRequestOptions;
};

function toDirEntry(entry: Entry): DirEntry {
  const kind: DirEntry['kind'] =
    entry.kind === EntryKind.SYMLINK
      ? 'symlink'
      : entry.kind === EntryKind.DIRECTORY
        ? 'directory'
        : entry.kind === EntryKind.FILE
          ? 'file'
          : 'special';

  const targetKind: DirEntry['targetKind'] =
    entry.targetKind === EntryKind.DIRECTORY
      ? 'directory'
      : entry.targetKind === EntryKind.FILE
        ? 'file'
        : undefined;

  const base: Pick<DirEntry, 'name' | 'kind'> = { name: entry.name, kind };

  const withTargetKind =
    targetKind === undefined ? base : { ...base, targetKind };

  return entry.linkTarget === undefined
    ? withTargetKind
    : { ...withTargetKind, target: entry.linkTarget };
}

async function readDirectoryEntries(
  session: MachineSession,
  path: string,
  limit: number,
  options?: MachineRequestOptions,
): Promise<DirectoryItems> {
  const entries: Array<Entry> = [];
  let total = 0;

  for (let offset = 0; offset < limit; offset += 1000) {
    const response = await rpc(
      session,
      (files, callOptions) =>
        files.listDirectory(
          { path, offset, limit: Math.min(1000, limit - offset) },
          callOptions,
        ),
      options,
    );

    if (response.result.case === 'failure') {
      const refusal = failure(response.result.value);
      throw new Error(refusal?.message ?? 'Directory listing failed.');
    }

    if (response.result.case !== 'directory') break;

    total = response.result.value.total;
    entries.push(...response.result.value.entries);

    if (entries.length >= total || response.result.value.entries.length === 0)
      break;
  }

  return { entries, total };
}

async function collectChildDirectory(
  session: MachineSession,
  request: ChildDirectoryRequest,
): Promise<{ child: ChildDir; remainingBudget: number }> {
  const { path, entry, budget, options } = request;
  const childPath = `${path.replace(/\/$/u, '')}/${entry.name}`;
  const first = await readDirectoryEntries(session, childPath, 1, options);

  if (first.total > budget) {
    return {
      child: {
        name: entry.name,
        entries: [],
        totalCount: first.total,
        overBudget: true,
      },
      remainingBudget: 0,
    };
  }

  const contents =
    first.entries.length === first.total
      ? first
      : await readDirectoryEntries(session, childPath, first.total, options);

  return {
    child: {
      name: entry.name,
      entries: contents.entries.map(toDirEntry),
      totalCount: contents.total,
      overBudget: false,
    },
    remainingBudget: budget - contents.entries.length,
  };
}

async function collectChildDirectories(
  session: MachineSession,
  path: string,
  root: DirectoryItems,
  options?: MachineRequestOptions,
): Promise<Array<ChildDir>> {
  const children: Array<ChildDir> = [];
  let budget = MAX_TREE_ENTRIES - root.entries.length;

  for (const entry of root.entries) {
    // A walk-policy fixed-set entry renders without children.
    if (entry.kind !== EntryKind.DIRECTORY || isWalkFixedName(entry.name))
      continue;

    const collected = await collectChildDirectory(session, {
      path,
      entry,
      budget,
      options,
    });

    children.push(collected.child);
    budget = collected.remainingBudget;
  }

  return children;
}

function renderDirectory(
  displayPath: string,
  reserveCodeUnits: number,
  root: DirectoryItems,
  children: Array<ChildDir>,
): FsReadResult {
  const rendered = renderCollectedDirectoryParts(
    displayPath,
    root.entries.map(toDirEntry),
    children,
    { displayPath, reserveCodeUnits },
  );

  if (rendered.status === 'error') {
    return {
      status: 'error',
      type: isNativeFailureType(rendered.type)
        ? rendered.type
        : 'executor_unavailable',
      message: rendered.message,
    };
  }

  return {
    status: 'success',
    kind: 'directory',
    path: displayPath,
    content: rendered.content,
    truncated: rendered.truncated,
    entryCount: rendered.entryCount,
  };
}

async function readDirectory(
  session: MachineSession,
  request: DirectoryRequest,
  displayPath: string,
): Promise<FsReadResult> {
  const root = await readDirectoryEntries(
    session,
    request.path,
    MAX_TREE_ENTRIES + 1,
    request.options,
  );

  if (root.total > MAX_TREE_ENTRIES) {
    return {
      status: 'error',
      type: 'directory_too_large',
      message: `Directory contains ${root.total} entries, exceeding the ${MAX_TREE_ENTRIES} entry budget.`,
      count: root.total,
    };
  }

  const children = await collectChildDirectories(
    session,
    request.path,
    root,
    request.options,
  );

  return renderDirectory(displayPath, request.reserveCodeUnits, root, children);
}

export async function listDirectory(
  session: MachineSession,
  request: DirectoryRequest,
): Promise<FsReadResult> {
  const displayPath = renderPath(request.path, request.prefix);

  try {
    return await readDirectory(session, request, displayPath);
  } catch (error) {
    return isNativeFailure(error)
      ? error
      : {
          status: 'error',
          type: 'executor_unavailable',
          message: error instanceof Error ? error.message : String(error),
        };
  }
}
