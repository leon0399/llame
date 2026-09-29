/**
 * Candidate resolution and bounded reading for per-directory instruction files
 * (openspec/changes/instruction-files, design D3/D4/D6/D8).
 *
 * The probe and the page reader are injected: existence is probed on the native
 * executor without a permission decision, and each existing candidate is then
 * read through the native `read` tool, so the `read` permission group stays the
 * only authority over what may enter the model's context.
 */

import { readdir } from 'node:fs/promises';
import { posix } from 'node:path';

import {
  type HostPathStat,
  MAX_READ_LINES,
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
 * Every directory from the filesystem root down to `directory`, inclusive and
 * broadest first. `directory` is absolute and normalized.
 */
export function walkDirectories(directory: string): Array<string> {
  const directories = ['/'];
  let current = '';
  for (const segment of directory.split('/')) {
    if (segment === '') continue;
    current += `/${segment}`;
    directories.push(current);
  }
  return directories;
}

/**
 * The directory a native read/edit/write path touches: the path itself when it
 * is an existing directory, else its parent, whether or not that parent exists.
 */
export async function touchedDirectory(
  absolutePath: string,
  stat: StatHostPath,
): Promise<string> {
  const probe = await stat(absolutePath);
  return probe.kind === 'directory'
    ? absolutePath
    : posix.dirname(absolutePath);
}

export interface InstructionCandidate {
  /** The absolute path as selected in the walk; it labels the model-visible block. */
  readonly path: string;
  /** The canonical path; the seen-set key that collapses symlink duplicates. */
  readonly canonicalPath: string;
  /** The probed byte size, the baseline for the omitted-byte count. */
  readonly size: number;
}

/**
 * The exact names one directory holds: nothing is probed for a name the
 * directory does not list under that exact spelling, so a case-insensitive host
 * cannot match `AGENTS.md` to `agents.md`. A directory that cannot be listed
 * (missing, unreadable) yields no candidates.
 */
async function listDirectoryNames(
  directory: string,
): Promise<ReadonlyArray<string>> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

/**
 * One base candidate and, independently, one local candidate for `directory`,
 * base first. Only names the listing carries are probed, matched exactly in
 * chain order; a non-regular entry continues the chain; an empty regular file
 * is selected and ends it.
 */
export async function selectCandidates(
  directory: string,
  stat: StatHostPath,
): Promise<Array<InstructionCandidate>> {
  const listed = await listDirectoryNames(directory);
  const candidates: Array<InstructionCandidate> = [];
  for (const chain of [BASE_CHAIN, LOCAL_CHAIN]) {
    for (const name of chain) {
      if (!listed.includes(name)) continue;
      const path = posix.join(directory, name);
      const probe = await stat(path);
      if (probe.kind !== 'file') continue;
      candidates.push({
        path,
        canonicalPath: probe.canonicalPath,
        size: probe.size,
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
      `${candidate.path}:raw:${from}-${from + MAX_READ_LINES - 1}`,
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
      // The cut is a truncation even when the probed size is stale (a file
      // that grew after the probe): more was read than the collection kept.
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
