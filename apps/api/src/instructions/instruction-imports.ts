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
  /** Candidates and import targets already attempted in this bundle. */
  readonly attempted: Set<string>;
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
}

/** State shared by one world's chain and its recursive imports. */
export interface InstructionImportState {
  readonly collector: InstructionImportCollector;
  readonly group: InstructionImportGroup;
  /** Canonical files directly disclosed in each trigger directory. */
  readonly disclosed: ReadonlyMap<string, ReadonlySet<string>>;
  readonly abortSignal: AbortSignal | undefined;
}

interface ResolvedImport {
  readonly key: string;
  readonly path: string;
}

const IMPORT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const IMPORT_PAGE = ':raw:1-2000';
const MAX_IMPORT_HOPS = 5;
const EMPTY_DISCLOSED: ReadonlySet<string> = new Set<string>();

function resolveImport(
  group: InstructionImportGroup,
  importer: string,
  target: string,
): ResolvedImport | undefined {
  if (
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
  if (target.startsWith('/')) return undefined;
  const base = candidateDirectory(group, importer);
  if (base === undefined) return undefined;
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
  const parsed = parseKnowledgeLocator(path.slice(prefix.length));
  if ('type' in parsed) return undefined;
  return parsed.relativePath === undefined
    ? group.scope.root
    : parentKey(parsed.relativePath, group.scope.root);
}

function disclosedForImport(
  state: InstructionImportState,
  path: string,
): ReadonlySet<string> {
  const directory = candidateDirectory(state.group, path);
  return directory === undefined
    ? EMPTY_DISCLOSED
    : (state.disclosed.get(directory) ?? EMPTY_DISCLOSED);
}

/** Reads one candidate into the collector, unless it is disclosed or seen. */
export async function collectInstructionCandidate(
  state: InstructionImportState,
  candidate: InstructionCandidate,
  disclosed: ReadonlySet<string>,
  origin: { hop: number; importedBy?: string },
): Promise<void> {
  const { collector, group } = state;
  if (collector.keys.has(candidate.canonicalPath)) return;
  if (disclosed.has(candidate.canonicalPath)) return;
  if (collector.attempted.has(candidate.canonicalPath)) return;
  collector.attempted.add(candidate.canonicalPath);
  collector.attempted.add(candidate.path);
  const read = await readInstructionFile(candidate, group.page);
  if (read.kind === 'denied') {
    collector.denied.push(candidate.path);
    return;
  }
  if (read.kind === 'failed') return;
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
  collector.files.push(
    origin.importedBy === undefined
      ? file
      : { ...file, importedBy: origin.importedBy },
  );
  if (origin.importedBy !== undefined) {
    const directory = candidateDirectory(group, candidate.path);
    if (directory !== undefined) await loadDirectoryChain(state, directory);
  }
  await expandImports(state, candidate.path, read.content, origin.hop);
}

async function loadResolvedImport(
  state: InstructionImportState,
  importer: string,
  resolved: ResolvedImport,
  hop: number,
): Promise<void> {
  const { collector, group } = state;
  if (collector.attempted.has(resolved.path)) return;
  if (!group.admitsRead(resolved.path)) {
    collector.attempted.add(resolved.path);
    await group.page(`${resolved.path}${IMPORT_PAGE}`);
    collector.denied.push(resolved.path);
    return;
  }
  const probe = await group.scope.probe(resolved.key);
  if (probe.kind !== 'file') {
    collector.attempted.add(resolved.path);
    return;
  }
  const attemptedCanonical = collector.attempted.has(probe.canonicalPath);
  if (attemptedCanonical) return;
  if (probe.canonicalPath !== resolved.path) {
    collector.attempted.add(resolved.path);
    collector.attempted.add(probe.canonicalPath);
    collector.denied.push(resolved.path);
    return;
  }
  const candidate: InstructionCandidate = {
    path: resolved.path,
    canonicalPath: probe.canonicalPath,
    size: probe.size,
  };
  const disclosed = disclosedForImport(state, resolved.path);
  await collectInstructionCandidate(state, candidate, disclosed, {
    hop: hop + 1,
    importedBy: importer,
  });
  collector.attempted.add(resolved.path);
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
 * fresh roots for hop counting, and explicit imports inherit the directory's
 * world, disclosed set, and the bundle's seen set.
 */
async function loadDirectoryChain(
  state: InstructionImportState,
  directory: string,
): Promise<void> {
  const { group } = state;
  for (const chainDirectory of walkFrom(group.scope.root, directory)) {
    state.abortSignal?.throwIfAborted();
    const disclosed = state.disclosed.get(chainDirectory) ?? EMPTY_DISCLOSED;
    const candidates = await selectCandidates(group.scope, chainDirectory);
    for (const candidate of candidates) {
      state.abortSignal?.throwIfAborted();
      await collectInstructionCandidate(state, candidate, disclosed, {
        hop: 0,
      });
    }
  }
}
