/**
 * Candidate resolution and bounded reading for per-directory instruction files
 * (openspec/changes/instruction-files, design D3/D4/D6/D8).
 *
 * The probe and the page reader are injected: existence is probed on the native
 * executor without a permission decision, and each existing candidate is then
 * read through the native `read` tool, so the `read` permission group stays the
 * only authority over what may enter the model's context.
 */

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

async function firstCandidate(
  directory: string,
  chain: ReadonlyArray<string>,
  stat: StatHostPath,
): Promise<InstructionCandidate | undefined> {
  for (const name of chain) {
    const path = posix.join(directory, name);
    const probe = await stat(path);
    if (probe.kind === 'file')
      return { path, canonicalPath: probe.canonicalPath, size: probe.size };
  }
  return undefined;
}

async function chainCandidate(
  directory: string,
  chain: ReadonlyArray<string>,
  stat: StatHostPath,
): Promise<Array<InstructionCandidate>> {
  const candidate = await firstCandidate(directory, chain, stat);
  return candidate === undefined ? [] : [candidate];
}

/**
 * One base candidate and, independently, one local candidate for `directory`,
 * base first. A non-regular entry continues the chain; an empty regular file is
 * selected and ends it.
 */
export async function selectCandidates(
  directory: string,
  stat: StatHostPath,
): Promise<Array<InstructionCandidate>> {
  const base = await chainCandidate(directory, BASE_CHAIN, stat);
  const local = await chainCandidate(directory, LOCAL_CHAIN, stat);
  return [...base, ...local];
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

/** One raw page's content and, when another page follows, its zero-based continuation line. */
type InstructionPage = {
  readonly content: string;
  readonly nextOffset: number | undefined;
};

/** The page a native file-read result carries; undefined for any other result. */
function pageOf(result: ToolResult): InstructionPage | undefined {
  if (result.status !== 'success') return undefined;
  const { content, nextOffset } = result;
  if (!isString(content)) return undefined;
  return { content, nextOffset: isNumber(nextOffset) ? nextOffset : undefined };
}

/** The longest prefix of `value` whose UTF-8 encoding fits `limit` bytes. */
function cutToByteLimit(value: string, limit: number): string {
  let cut = 0;
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > limit) break;
    bytes += size;
    cut += character.length;
  }
  return value.slice(0, cut);
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

/** Complete source lines in one page's content. */
function lineCount(content: string): number {
  let lines = 0;
  for (const character of content) if (character === '\n') lines += 1;
  return lines;
}

/**
 * Read one candidate as consecutive bounded `:raw` pages, cut at
 * INSTRUCTION_FILE_BYTE_LIMIT UTF-8 bytes on a character boundary.
 *
 * Continuation is derived from the complete lines collected rather than from a
 * page's `nextOffset`, which points past a line the native reader could not
 * render: re-requesting that line as a page's first line is what turns the skip
 * into the no-progress stop instead of silently collecting text after a hole.
 * A page that adds no line ends the file there, as does `invalid_selector` on a
 * continuation page; a `permission_denied` page denies the whole file and any
 * other error fails it.
 */
export async function readInstructionFile(
  candidate: InstructionCandidate,
  readPage: ReadPage,
): Promise<InstructionFileRead> {
  let content = '';
  let lines = 0;
  let firstPage = true;
  for (;;) {
    const from = lines + 1;
    const result = await readPage(
      `${candidate.path}:raw:${from}-${from + MAX_READ_LINES - 1}`,
    );
    if (result.status === 'error') {
      if (result.type === 'permission_denied') return { kind: 'denied' };
      if (result.type === 'invalid_selector' && !firstPage) break;
      return { kind: 'failed' };
    }
    const page = pageOf(result);
    if (page === undefined) return { kind: 'failed' };
    if (page.content === '') break;
    content += page.content;
    if (Buffer.byteLength(content, 'utf8') >= INSTRUCTION_FILE_BYTE_LIMIT)
      return loaded(
        candidate,
        cutToByteLimit(content, INSTRUCTION_FILE_BYTE_LIMIT),
      );
    if (page.nextOffset === undefined) break;
    const added = lineCount(page.content);
    if (added === 0) break;
    lines += added;
    firstPage = false;
  }
  return loaded(candidate, content);
}
