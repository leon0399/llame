/**
 * Candidate resolution and bounded reading for per-directory instruction files
 * (openspec/changes/instruction-files, design D3/D4/D6/D8).
 *
 * Every world a trigger can name is addressed by an `InstructionScope`: keys
 * are absolute host paths for the filesystem and Space-relative paths for a
 * Knowledge Space, and the scope decides what an entry is labelled and keyed
 * by. The probe and the page reader are injected: existence is probed without
 * a permission decision, and each existing candidate is then read through the
 * native `read` tool, so the `read` permission group stays the only authority
 * over what may enter the model's context.
 */

import { readdir } from 'node:fs/promises';

import {
  type HostPathStat,
  MAX_READ_LINES,
  statHostPath,
} from '@workspace/native-file-tools';
import { isNumber, isString } from '@workspace/runtime-safety';

import { type ToolResult } from '../tools/types';

/** First existing regular file per directory wins; an earlier name replaces later ones. */
export const BASE_CHAIN = [
  'LLAME.override.md',
  'LLAME.md',
  'AGENTS.override.md',
  'AGENTS.md',
  'CLAUDE.override.md',
  'CLAUDE.md',
] as const;

/** Selected independently of the base chain, base file first in a bundle. */
export const LOCAL_CHAIN = [
  'LLAME.local.md',
  'AGENTS.local.md',
  'CLAUDE.local.md',
] as const;

/** One model-visible file body is cut at this many UTF-8 bytes. */
export const INSTRUCTION_FILE_BYTE_LIMIT = 32 * 1024;

export type StatHostPath = (path: string) => Promise<HostPathStat>;

/**
 * How one trigger's world is addressed. A key is an absolute host path for the
 * filesystem and a Space-relative path for a Knowledge Space, where the empty
 * key is the Space's own directory. The scope supplies the label an entry is
 * named by, the canonical identity it is keyed by, and the listing the chain
 * is selected from, so every world shares one selection and read contract.
 */
export interface InstructionScope {
  /** The broadest directory this world walks: `/`, or a Space's own directory. */
  readonly root: string;
  /** The logical label of one key: an absolute host path or a `kb://` locator. */
  readonly label: (key: string) => string;
  /**
   * The selector a page read of `key` is issued under. It is `label` itself
   * for the host. A Knowledge Space spells the same locator with the Space id
   * as the step's first triggering call spelled it, so the audited `read` of a
   * candidate is evaluated against the same spelling the model's own read of
   * that Space was — never a second, differently spelled one.
   */
  readonly readLabel: (key: string) => string;
  /**
   * One key, resolved. `canonicalPath` is the identity a seen set and a
   * self-read exclusion compare: a host realpath, or the logical locator for a
   * Knowledge Space, which resolves no links.
   */
  readonly probe: (key: string) => Promise<HostPathStat>;
  /** The exact entry names one directory key holds; empty when it cannot be listed. */
  readonly list: (key: string) => Promise<ReadonlyArray<string>>;
}

/** The host filesystem: keys are absolute paths, identities are realpaths. */
export function hostInstructionScope(
  stat: StatHostPath = statHostPath,
): InstructionScope {
  return {
    root: '/',
    label: (key) => key,
    readLabel: (key) => key,
    probe: stat,
    list: listDirectoryNames,
  };
}

/** One entry's key inside `key`; a root directory holds the bare name. */
function joinKey(key: string, name: string): string {
  return key === '' || key === '/' ? `${key}${name}` : `${key}/${name}`;
}

/** The directory holding `key`, or the world's own root for a top-level key. */
export function parentKey(key: string, root: string): string {
  // A cut at or before the first separator, and no cut at all, both mean the
  // key has no directory of its own: the empty prefix is the world root.
  const cut = key.lastIndexOf('/');
  return cut <= 0 ? root : key.slice(0, cut);
}

/**
 * Every directory from `root` down to `key`, inclusive and broadest first. The
 * walk never leaves `root`, so a Space never reaches a host ancestor.
 */
export function walkFrom(root: string, key: string): Array<string> {
  const directories = [root];
  let current = '';
  for (const segment of key.split('/')) {
    if (segment === '') continue;
    current = current === '' ? segment : `${current}/${segment}`;
    directories.push(joinKey(root, current));
  }
  return directories;
}

/**
 * The directory a native read/edit/write path touches, together with the file
 * identity of that one probe. `directory` is a key of the same scope.
 */
export interface TouchedPath {
  /**
   * The key itself when it is an existing directory, else its parent, whether
   * or not that parent exists.
   */
  readonly directory: string;
  /**
   * The canonical identity of the regular file the key names — a host realpath
   * with symlinks followed, or the logical locator in a Space, which resolves
   * no links. Undefined for a directory, a non-regular entry, and a key that
   * does not exist. The producer compares it against candidate canonical paths,
   * so one probe answers both questions.
   */
  readonly canonicalPath: string | undefined;
}

/**
 * Probe one path: the directory it touches, plus its canonical file identity
 * when it names a regular file.
 */
export async function touchedPath(
  scope: InstructionScope,
  key: string,
): Promise<TouchedPath> {
  const probe = await scope.probe(key);
  return {
    directory: probe.kind === 'directory' ? key : parentKey(key, scope.root),
    canonicalPath: probe.kind === 'file' ? probe.canonicalPath : undefined,
  };
}

export interface InstructionCandidate {
  /** The label as selected in the walk; it names the model-visible block. */
  readonly path: string;
  /** The canonical identity; the seen-set key that collapses duplicates. */
  readonly canonicalPath: string;
  /** The probed byte size, the baseline for the omitted-byte count. */
  readonly size: number;
  /**
   * The selector the page read is issued under. It equals `path` for the host
   * and is the only place a Space's read spelling appears: the model sees and
   * the seen set keys the canonical label, while the permission group sees the
   * spelling the step's own call used.
   */
  readonly readPath: string;
}

/**
 * The exact names one directory holds: nothing is probed for a name the
 * directory does not list under that exact spelling, so a case-insensitive host
 * cannot match `AGENTS.md` to `agents.md`. A directory that cannot be listed
 * (missing, unreadable) yields no candidates.
 */
export async function listDirectoryNames(
  directory: string,
): Promise<ReadonlyArray<string>> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

/**
 * One base candidate and, independently, one local candidate for `key`, base
 * first. Only names the listing carries are probed, matched exactly in chain
 * order; a non-regular entry continues the chain; an empty regular file is
 * selected and ends it.
 */
export async function selectCandidates(
  scope: InstructionScope,
  key: string,
): Promise<Array<InstructionCandidate>> {
  const listed = await scope.list(key);
  const candidates: Array<InstructionCandidate> = [];
  for (const chain of [BASE_CHAIN, LOCAL_CHAIN]) {
    for (const name of chain) {
      if (!listed.includes(name)) continue;
      const entry = joinKey(key, name);
      const probe = await scope.probe(entry);
      if (probe.kind !== 'file') continue;
      candidates.push({
        path: scope.label(entry),
        canonicalPath: probe.canonicalPath,
        size: probe.size,
        readPath: scope.readLabel(entry),
      });
      break;
    }
  }
  return candidates;
}

export type ReadPage = (selectorPath: string) => Promise<ToolResult>;

export type InstructionFileRead =
  | {
      readonly kind: 'loaded';
      readonly content: string;
      readonly truncated: boolean;
      readonly omittedBytes: number;
    }
  | { readonly kind: 'denied' }
  | { readonly kind: 'failed' };

/** The longest prefix of `value` whose UTF-8 encoding fits `limit` bytes. */
function cutToByteLimit(value: string, limit: number): string {
  const buffer = new Uint8Array(limit);
  return value.slice(0, new TextEncoder().encodeInto(value, buffer).read);
}

function loaded(
  candidate: InstructionCandidate,
  content: string,
): InstructionFileRead {
  const omittedBytes = Math.max(
    0,
    candidate.size - Buffer.byteLength(content, 'utf8'),
  );
  return { kind: 'loaded', content, truncated: omittedBytes > 0, omittedBytes };
}

/**
 * Read one candidate as consecutive bounded `:raw` pages, cut at
 * INSTRUCTION_FILE_BYTE_LIMIT UTF-8 bytes on a character boundary.
 *
 * Each page starts after the last complete line collected, never at the
 * previous page's `nextOffset`: that offset points past a line the native
 * reader could not render, so starting there would silently join text across
 * the hole. A page that adds no line ends the file there, as does
 * `invalid_selector` on a continuation page; a `permission_denied` page denies
 * the whole file and any other error fails it.
 */
export async function readInstructionFile(
  candidate: InstructionCandidate,
  readPage: ReadPage,
): Promise<InstructionFileRead> {
  let content = '';
  let lines = 0;
  for (;;) {
    const from = lines + 1;
    const result = await readPage(
      `${candidate.readPath}:raw:${from}-${from + MAX_READ_LINES - 1}`,
    );
    if (result.status === 'error') {
      if (result.type === 'permission_denied') return { kind: 'denied' };
      if (result.type === 'invalid_selector' && lines > 0) break;
      return { kind: 'failed' };
    }
    if (!isString(result.content)) return { kind: 'failed' };
    if (result.content === '') break;
    content += result.content;
    if (Buffer.byteLength(content, 'utf8') >= INSTRUCTION_FILE_BYTE_LIMIT) {
      const cut = cutToByteLimit(content, INSTRUCTION_FILE_BYTE_LIMIT);
      // Dropping collected bytes is a truncation even when the probed size is
      // stale (a file that grew after the probe); a file of exactly the limit
      // loses nothing and falls back to the probed size.
      if (cut.length === content.length) return loaded(candidate, cut);
      return {
        kind: 'loaded',
        content: cut,
        truncated: true,
        omittedBytes: Math.max(
          1,
          candidate.size - Buffer.byteLength(cut, 'utf8'),
        ),
      };
    }
    if (!isNumber(result.nextOffset)) break;
    const added = result.content.split('\n').length - 1;
    if (added === 0) break;
    lines += added;
  }
  return loaded(candidate, content);
}
