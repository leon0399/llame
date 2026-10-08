/**
 * Expansion of explicit instruction-file imports.
 *
 * The producer resolves trigger worlds and candidate chains; this module owns
 * the import marker's target resolution, bounded recursion, and the directory
 * chain an imported file implicitly activates.
 */

import { posix } from 'node:path';

import { splitSelectorSuffix } from '@workspace/native-file-tools';

import { importTargets } from '../import-markers/import-markers';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import type { LoadedInstructionFile } from '../chats/instructions-item';
import {
  parentKey,
  readInstructionFile,
  selectCandidates,
  walkFrom,
  type InstructionCandidate,
  type InstructionScope,
  type ReadPage,
} from './instruction-files';

/** The files and seen keys shared by one trigger set. */
export interface InstructionImportCollector {
  /** The attempt's seen keys, plus every canonical path loaded so far. */
  readonly keys: Set<string>;
  readonly files: Array<LoadedInstructionFile>;
  readonly denied: Array<string>;
}

/** One world an instruction trigger set walks. */
export interface InstructionImportGroup {
  readonly scope: InstructionScope;
  readonly page: ReadPage;
  readonly admitsRead: (path: string) => boolean;
  readonly directories: Map<string, ReadonlySet<string>>;
  /** A Space group's files are owner-maintained Knowledge content. */
  readonly knowledge: boolean;
  /** The Knowledge Space id, absent for the host filesystem. */
  readonly spaceId?: string;
}

/** State shared by one world's chain and its recursive imports. */
export interface InstructionImportState {
  readonly collector: InstructionImportCollector;
  readonly group: InstructionImportGroup;
  readonly abortSignal: AbortSignal | undefined;
  /** Canonical keys on the current recursive import path. */
  readonly inProgress: Set<string>;
}

interface CandidateLoad {
  /** The number of ordinary imports above this file. */
  readonly hop: number;
  /** Set only for a file loaded by an explicit import marker. */
  readonly importedBy?: string;
}

interface ResolvedImport {
  readonly key: string;
  readonly path: string;
}

const IMPORT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const IMPORT_PAGE = ':raw:1-2000';
const MAX_IMPORT_HOPS = 5;

function resolveImport(
  group: InstructionImportGroup,
  importer: string,
  target: string,
): ResolvedImport | undefined {
  if (
    target.length === 0 ||
    target.startsWith('~/') ||
    IMPORT_SCHEME.test(target) ||
    splitSelectorSuffix(target).selector !== undefined
  ) {
    return undefined;
  }
  if (!group.knowledge) {
    const key = target.startsWith('/')
      ? posix.normalize(target)
      : posix.resolve(posix.dirname(importer), target);
    return { key, path: key };
  }
  if (target.startsWith('/') || group.spaceId === undefined) return undefined;
  const prefix = `${KNOWLEDGE_LOCATOR_SCHEME}://`;
  if (!importer.startsWith(prefix)) return undefined;
  const parsed = parseKnowledgeLocator(importer.slice(prefix.length));
  if ('type' in parsed || parsed.knowledgeSpaceId !== group.spaceId) {
    return undefined;
  }
  const base = parentKey(parsed.relativePath ?? '', '');
  const key = posix.normalize(posix.join(base, target));
  if (key === '..' || key.startsWith('../')) return undefined;
  const relativePath = key === '.' ? '' : key;
  return {
    key: relativePath,
    path: group.scope.label(relativePath),
  };
}

function candidateDirectory(
  group: InstructionImportGroup,
  path: string,
): string | undefined {
  if (!group.knowledge) return parentKey(path, group.scope.root);
  const prefix = `${KNOWLEDGE_LOCATOR_SCHEME}://`;
  if (!path.startsWith(prefix)) return undefined;
  const parsed = parseKnowledgeLocator(path.slice(prefix.length));
  if ('type' in parsed) return undefined;
  return parentKey(parsed.relativePath ?? '', '');
}

/** Reads one candidate into the collector, unless it is disclosed or seen. */
export async function collectInstructionCandidate(
  state: InstructionImportState,
  candidate: InstructionCandidate,
  disclosed: ReadonlySet<string>,
  load: CandidateLoad,
): Promise<void> {
  const { collector, group } = state;
  if (collector.keys.has(candidate.canonicalPath)) return;
  if (disclosed.has(candidate.canonicalPath)) return;
  const read = await readInstructionFile(candidate, group.page);
  if (read.kind === 'denied') {
    collector.denied.push(candidate.path);
    return;
  }
  if (read.kind === 'failed') {
    if (load.importedBy !== undefined) collector.denied.push(candidate.path);
    return;
  }
  if (read.content.length === 0) return;
  collector.keys.add(candidate.canonicalPath);
  const file = {
    path: candidate.path,
    canonicalPath: candidate.canonicalPath,
    content: read.content,
    truncated: read.truncated,
    omittedBytes: read.omittedBytes,
    knowledge: group.knowledge,
  };
  if (load.importedBy !== undefined) {
    collector.files.push({ ...file, importedBy: load.importedBy });
  } else {
    collector.files.push(file);
  }
  if (load.importedBy !== undefined) {
    const directory = candidateDirectory(group, candidate.path);
    if (directory !== undefined) await loadDirectoryChain(state, directory);
  }
  await expandImports(state, candidate.path, read.content, load.hop);
}

async function loadResolvedImport(
  state: InstructionImportState,
  importer: string,
  resolved: ResolvedImport,
  hop: number,
): Promise<void> {
  if (!state.group.admitsRead(resolved.path)) {
    await state.group.page(`${resolved.path}${IMPORT_PAGE}`);
    state.collector.denied.push(resolved.path);
    return;
  }
  const probe = await state.group.scope.probe(resolved.key);
  if (probe.kind !== 'file') return;
  if (probe.canonicalPath !== resolved.path) {
    state.collector.denied.push(resolved.path);
    return;
  }
  if (
    state.collector.keys.has(probe.canonicalPath) ||
    state.inProgress.has(probe.canonicalPath)
  ) {
    return;
  }
  const candidate: InstructionCandidate = {
    path: resolved.path,
    canonicalPath: probe.canonicalPath,
    size: probe.size,
  };
  state.inProgress.add(candidate.canonicalPath);
  try {
    await collectInstructionCandidate(state, candidate, new Set<string>(), {
      hop: hop + 1,
      importedBy: importer,
    });
  } finally {
    state.inProgress.delete(candidate.canonicalPath);
  }
}

async function expandImports(
  state: InstructionImportState,
  importer: string,
  content: string,
  hop: number,
): Promise<void> {
  if (hop >= MAX_IMPORT_HOPS) return;
  for (const target of importTargets(content)) {
    state.abortSignal?.throwIfAborted();
    const resolved = resolveImport(state.group, importer, target);
    if (resolved !== undefined) {
      await loadResolvedImport(state, importer, resolved, hop);
    }
  }
}

/**
 * Walk an imported file's directory as a native trigger. Chain candidates are
 * fresh roots for hop counting, and explicit imports inherit only the
 * directory's world and the bundle's seen set.
 */
async function loadDirectoryChain(
  state: InstructionImportState,
  directory: string,
): Promise<void> {
  const { group } = state;
  for (const chainDirectory of walkFrom(group.scope.root, directory)) {
    state.abortSignal?.throwIfAborted();
    const candidates = await selectCandidates(group.scope, chainDirectory);
    for (const candidate of candidates) {
      state.abortSignal?.throwIfAborted();
      await collectInstructionCandidate(state, candidate, new Set<string>(), {
        hop: 0,
      });
    }
  }
}
