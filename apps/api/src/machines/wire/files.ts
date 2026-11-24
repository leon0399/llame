import { BYTES_NOTIFICATION, MEDIA_MAX_BYTES } from '@workspace/machine-protocol';
import { randomUUID } from 'node:crypto';
import {
  applySelectorSuffix,
  fileMediaType,
  outlineReader,
  renderCollectedDirectoryParts,
  similarNames,
  measureEditRendering,
  measureReadRendering,
  resolveEndRelativeSelector,
  selectMultiRangeLines,
  selectSourceLines,
  splitSourceLines,
  MAX_RESULT_CODE_UNITS,
  type ChildDir,
  type DirEntry,
  type ReadTarget,
} from '@workspace/native-file-tools';
import type {
  FsBytesResult,
  FsListResult,
  FsMutateResult,
  FsReadResult,
  FsStatResult,
  MachineMethodParams,
  NativeFailureResult,
} from '@workspace/machine-protocol';
import { EntryKind, FileFailureReason, WriteMode } from '@workspace/machine-protocol';
import type { Handler } from './index.js';
import type { MachineRequestOptions, MachineSession } from '../machine-session.js';

const MAX_TREE_ENTRIES = 10_000;
const READ_WINDOW_LINES = 2000;

type Rpc = (request: Record<string, unknown>, options?: unknown) => Promise<any>;
type FilesClient = Record<string, Rpc>;
type FileSession = MachineSession & { readonly clients: { readonly files: FilesClient }; callOptions(options?: MachineRequestOptions): unknown; mapRefusal(error: unknown): Error };
type Entry = { name: string; kind: EntryKind; size?: bigint; linkTarget?: string; targetKind?: EntryKind };
type FileFailure = { reason: FileFailureReason; message: string; count?: number };
type BytesStreamRpc = (request: Record<string, unknown>, options?: unknown) => AsyncIterable<{ result: { case?: string; value?: unknown } }>;

const failureTypes: Partial<Record<FileFailureReason, NativeFailureResult['type']>> = {
  [FileFailureReason.NOT_FOUND]: 'not_found',
  [FileFailureReason.WRONG_KIND]: 'not_regular_file',
  [FileFailureReason.NOT_UTF8]: 'invalid_utf8',
  [FileFailureReason.ALREADY_EXISTS]: 'file_exists',
  [FileFailureReason.TEXT_NOT_FOUND]: 'old_text_not_found',
  [FileFailureReason.TEXT_AMBIGUOUS]: 'old_text_ambiguous',
  [FileFailureReason.OUTCOME_UNKNOWN]: 'outcome_unknown',
  [FileFailureReason.DIRECTORY_TOO_LARGE]: 'directory_too_large',
  [FileFailureReason.FILE_TOO_LARGE]: 'representation_too_large',
  [FileFailureReason.IO]: 'executor_unavailable',
};

function failure(value: FileFailure | undefined): NativeFailureResult | undefined {
  if (value === undefined) return undefined;
  return { status: 'error', type: failureTypes[value.reason] ?? 'executor_unavailable', message: value.message, ...(value.count === undefined ? {} : { count: value.count }) };
}

function renderPath(_session: MachineSession, path: string, prefix: string): string {
  return `${prefix}${path}`;
}

async function rpc(session: MachineSession, method: string, request: Record<string, unknown>, options?: MachineRequestOptions): Promise<any> {
  const fileSession = session as FileSession;
  try {
    const response = await fileSession.clients.files[method](request, fileSession.callOptions(options));
    if (response && typeof response === 'object' && 'result' in response) {
      const result = response.result as { case?: string; value?: unknown };
      return result.case === undefined ? {} : { [result.case]: result.value };
    }
    return response;
  } catch (error) {
    throw fileSession.mapRefusal(error);
  }
}

function mapEntryKind(kind: EntryKind): 'file' | 'directory' | 'link' | 'other' {
  if (kind === EntryKind.FILE) return 'file';
  if (kind === EntryKind.DIRECTORY) return 'directory';
  if (kind === EntryKind.SYMLINK) return 'link';
  return 'other';
}

export const statHandler: Handler<'fs.stat'> = async (session, params, options) => {
  const result = await rpc(session, 'getEntry', { path: params.path }, options);
  if (result.failure) {
    if (result.failure.reason === FileFailureReason.NOT_FOUND) return { kind: 'missing', isLink: false } satisfies FsStatResult;
    throw new Error(result.failure.message);
  }
  const entry = result.entry as Entry;
  const kind: FsStatResult['kind'] = entry.kind === EntryKind.FILE ? 'file' : entry.kind === EntryKind.DIRECTORY ? 'directory' : entry.kind === EntryKind.SYMLINK ? 'other' : 'other';
  return { kind, ...(entry.size === undefined ? {} : { size: Number(entry.size) }), realPath: entry.name, isLink: entry.kind === EntryKind.SYMLINK } satisfies FsStatResult;
};

async function listDirectory(session: MachineSession, path: string, prefix: string, reserveCodeUnits: number, options?: MachineRequestOptions): Promise<FsReadResult> {
  const displayPath = renderPath(session, path, prefix);
  const readEntries = async (directory: string, limit: number): Promise<{ entries: Entry[]; total: number }> => {
    const entries: Entry[] = [];
    let total = 0;
    for (let offset = 0; offset < limit; offset += 1000) {
      const response = await rpc(session, 'listDirectory', { path: directory, offset, limit: Math.min(1000, limit - offset) }, options);
      const refused = failure(response.failure);
      if (refused) throw refused;
      const listing = response.directory;
      total = listing.total;
      entries.push(...(listing.entries as Entry[]));
      if (entries.length >= total || listing.entries.length === 0) break;
    }
    return { entries, total };
  };
  try {
    const root = await readEntries(path, MAX_TREE_ENTRIES + 1);
    if (root.total > MAX_TREE_ENTRIES)
      return { status: 'error', type: 'directory_too_large', message: `Directory contains ${root.total} entries, exceeding the ${MAX_TREE_ENTRIES} entry budget.`, count: root.total };
    const rootEntries = root.entries.map(toDirEntry);
    let budget = MAX_TREE_ENTRIES - rootEntries.length;
    const children: ChildDir[] = [];
    for (const entry of root.entries) {
      if (entry.kind !== EntryKind.DIRECTORY) continue;
      const childPath = `${path.replace(/\/$/u, '')}/${entry.name}`;
      const first = await readEntries(childPath, 1);
      if (first.total > budget) {
        children.push({ name: entry.name, entries: [], totalCount: first.total, overBudget: true });
        budget = 0;
        continue;
      }
      const child = first.entries.length === first.total
        ? first
        : await readEntries(childPath, first.total);
      budget -= child.entries.length;
      children.push({ name: entry.name, entries: child.entries.map(toDirEntry), totalCount: child.total, overBudget: false });
    }
    const rendered = renderCollectedDirectoryParts(displayPath, rootEntries, children, { displayPath, reserveCodeUnits });
    if (rendered.status === 'error') return { status: 'error', type: rendered.type as NativeFailureResult['type'], message: rendered.message };
    return { status: 'success', kind: 'directory', path: displayPath, content: rendered.content, truncated: rendered.truncated, entryCount: rendered.entryCount };
  } catch (error) {
    return isNativeFailure(error) ? error : { status: 'error', type: 'executor_unavailable', message: error instanceof Error ? error.message : String(error) };
  }
}

function toDirEntry(entry: Entry): DirEntry {
  const kind = entry.kind === EntryKind.SYMLINK ? 'symlink' : entry.kind === EntryKind.DIRECTORY ? 'directory' : entry.kind === EntryKind.FILE ? 'file' : 'special';
  const targetKind = entry.targetKind === EntryKind.DIRECTORY ? 'directory' : entry.targetKind === EntryKind.FILE ? 'file' : undefined;
  return { name: entry.name, kind, ...(targetKind === undefined ? {} : { targetKind }), ...(entry.linkTarget === undefined ? {} : { target: entry.linkTarget }) };
}

function isNativeFailure(error: unknown): error is NativeFailureResult {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 'error';
}

async function getEntry(session: MachineSession, path: string, options?: MachineRequestOptions): Promise<Entry | NativeFailureResult> {
  const result = await rpc(session, 'getEntry', { path }, options);
  const refused = failure(result.failure);
  return refused ?? result.entry;
}

async function readRange(session: MachineSession, path: string, start: number, limit: number, options?: MachineRequestOptions): Promise<{ lines: string[]; count: number; ending: string; truncated: boolean } | NativeFailureResult> {
  const result = await rpc(session, 'readLines', { path, startLine: start, limit, maxBytes: 4n * 1024n * 1024n }, options);
  const refused = failure(result.failure);
  if (refused) return refused;
  const lines = result.lines;
  return { lines: lines.lines as string[], count: lines.lineCount, ending: lines.lineEnding || '\n', truncated: lines.truncated };
}

export const readHandler: Handler<'fs.read'> = async (session, params, options) => {
  let target: ReadTarget;
  try { target = applySelectorSuffix(params.path, params.options.selector); }
  catch (error) { return { status: 'error', type: 'invalid_selector', message: error instanceof Error ? error.message : String(error) }; }
  const prefix = params.options.displayPrefix;
  const displayPath = renderPath(session, params.path, prefix);
  const entry = await getEntry(session, params.path, options);
  if (isNativeFailure(entry)) {
    const parentPath = params.path.slice(0, params.path.lastIndexOf('/')) || '/';
    const parent = await rpc(session, 'listDirectory', { path: parentPath, offset: 0, limit: 1000 }, options);
    const parentFailure = failure(parent.failure);
    if (parentFailure?.type === 'not_found')
      return { status: 'error', type: 'not_found', message: 'File not found. Parent directory does not exist.' };
    if (parentFailure !== undefined) return parentFailure;
    const names = (parent.directory.entries as Entry[]).map((item) => item.name);
    const basename = params.path.slice(params.path.lastIndexOf('/') + 1);
    const suggestions = similarNames(basename, names);
    return {
      status: 'error',
      type: 'not_found',
      message: suggestions.length === 0
        ? 'File not found.'
        : `File not found. Similar names in the same directory: ${suggestions.join(', ')}.`,
    };
  }
  if (entry.kind === EntryKind.DIRECTORY) return listDirectory(session, params.path, prefix, params.options.reserveCodeUnits ?? 0, options);
  if (target.outline && fileMediaType(params.path) !== 'text/markdown') return { status: 'error', type: 'invalid_selector', message: 'The :outline member reads text/markdown content only; read this source without it.' };
  const all: string[] = [];
  let start = 1;
  let total = -1;
  let ending = '\n';
  while (total < 0 || start <= total) {
    const window = await readRange(session, params.path, start, READ_WINDOW_LINES, options);
    if (isNativeFailure(window)) return window;
    total = window.count;
    ending = window.ending;
    all.push(...window.lines);
    if (window.lines.length === 0 || start + window.lines.length > total) break;
    start += window.lines.length;
  }
  const source = all.map((line) => `${line}${ending}`).join('');
  try {
    const reserveCodeUnits = (params.options.reserveCodeUnits ?? 0) + displayPath.length - params.path.length;
    const resolved = resolveEndRelativeSelector({ ...target, reserveCodeUnits }, all.length);
    const selected = target.outline
      ? await outlineReader(fileMediaType(params.path))(all, resolved)
      : target.ranges !== undefined
        ? selectMultiRangeLines(source, resolved)
        : selectSourceLines(source, resolved, fileMediaType(params.path));
    const result = { ...selected, path: displayPath };
    if (measureReadRendering(result) > Math.min(MAX_RESULT_CODE_UNITS - (params.options.reserveCodeUnits ?? 0), 16_000))
      return { status: 'error', type: 'representation_too_large', message: 'The rendered read exceeds the 16 000-unit result bound.' };
    return result as FsReadResult;
  } catch (error) {
    const type = error && typeof error === 'object' && 'type' in error ? String(error.type) : 'invalid_selector';
    return { status: 'error', type: type as NativeFailureResult['type'], message: error instanceof Error ? error.message : String(error) };
  }
};

export const listHandler: Handler<'fs.list'> = async (session, params, options) => {
  const result = await rpc(session, 'listDirectory', { path: params.path, offset: 0, limit: 1000 }, options);
  const refused = failure(result.failure);
  if (refused) return refused;
  const directory = result.directory;
  return { entries: directory.entries.map((entry: Entry) => ({ name: entry.name, kind: mapEntryKind(entry.kind) })), totalCount: directory.total, truncated: directory.entries.length < directory.total } satisfies FsListResult;
};

export const editHandler: Handler<'fs.edit'> = async (session, params, options) => {
  const result = await rpc(session, 'replaceText', { requestId: randomUUID(), path: params.path, oldText: params.oldText, newText: params.newText }, options);
  const refused = failure(result.failure);
  if (refused) return refused;
  const changed = result.replaced;
  const startLine = Math.max(1, changed.startLine - 2);
  const source = await readRange(session, params.path, startLine, splitSourceLines(params.newText).length + 4, options);
  const lines = isNativeFailure(source) ? [] : source.lines;
  const mutation = {
    status: 'success',
    operation: 'edit',
    path: renderPath(session, params.path, params.options.displayPrefix),
    replacements: 1,
    lineCount: changed.lineCount,
    content: lines.map((line, index) => `${startLine + index}: ${line}\n`).join(''),
    shownRange: lines.length === 0 ? null : { startLine, endLine: startLine + lines.length - 1 },
    truncated: false,
    display: { startLine: changed.startLine, oldText: params.oldText, newText: params.newText },
  } as const;
  const mutable = mutation as { content: string; shownRange: { startLine: number; endLine: number } | null; truncated: boolean };
  while (measureEditRendering(mutable) > Math.min(MAX_RESULT_CODE_UNITS - (params.options.reserveCodeUnits ?? 0), 16_000) && mutable.content.length > 0) {
    const previousLine = mutable.content.lastIndexOf('\n', mutable.content.length - 2);
    mutable.content = previousLine < 0 ? '' : mutable.content.slice(0, previousLine + 1);
    if (mutable.shownRange !== null) {
      const endLine = mutable.content.split('\n').length - 1 + mutable.shownRange.startLine - 1;
      mutable.shownRange = endLine < mutable.shownRange.startLine ? null : { ...mutable.shownRange, endLine };
    }
    mutable.truncated = true;
  }
  return mutation as FsMutateResult;
};

export const writeHandler: Handler<'fs.write'> = async (session, params, options) => {
  const mode = params.replace === true ? WriteMode.REPLACE : WriteMode.CREATE;
  const encoded = new TextEncoder().encode(params.content);
  const content = new Uint8Array(encoded.length);
  content.set(encoded);
  const result = await rpc(session, 'writeFile', { requestId: randomUUID(), path: params.path, content, mode, createParents: true }, options);
  const refused = failure(result.failure);
  if (refused) return refused;
  return { status: 'success', operation: 'write', path: renderPath(session, params.path, params.options.displayPrefix), ...(result.written.created ? { created: true as const } : { replaced: true as const }), lineCount: splitSourceLines(params.content).length } as FsMutateResult;
};

export const bytesHandler: Handler<'fs.bytes'> = async (session, params, options) => {
  const fileSession = session as FileSession;
  const readBytes = fileSession.clients.files.readBytes as unknown as BytesStreamRpc;
  const stream = readBytes(
    { path: params.path, offset: 0n, limit: 0n },
    fileSession.callOptions(options),
  );
  const onNotification = options?.onNotification;
  let size = 0n;
  let head = new Uint8Array();
  let seq = 0;
  for await (const frame of stream) {
    const result = frame.result;
    if (result.case === 'failure')
      return failure(result.value as FileFailure) ?? { status: 'error', type: 'executor_unavailable', message: 'File bytes could not be read.' };
    if (result.case === 'size') size = result.value as bigint;
    if (result.case === 'chunk') {
      const chunk = result.value as Uint8Array;
      if (head.length < 12) {
        const sample = new Uint8Array(Math.min(12, head.length + chunk.length));
        sample.set(head);
        sample.set(chunk.subarray(0, sample.length - head.length), head.length);
        head = sample;
        if (size > BigInt(MEDIA_MAX_BYTES) && head.length >= 12 && sniffMediaType(head) !== 'application/octet-stream')
          return { status: 'error', type: 'media_too_large', message: 'The file exceeds the media byte bound.' };
      }
      onNotification?.({
        method: BYTES_NOTIFICATION,
        params: { seq, data: Buffer.from(chunk).toString('base64') },
      });
      seq += 1;
    }
  }
  return { size: Number(size), mediaType: sniffMediaType(head) } satisfies FsBytesResult;
};

function sniffMediaType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a') return 'image/gif';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  return 'application/octet-stream';
}

export const filesHandlers = {
  'fs.stat': statHandler,
  'fs.list': listHandler,
  'fs.read': readHandler,
  'fs.edit': editHandler,
  'fs.write': writeHandler,
  'fs.bytes': bytesHandler,
} satisfies Partial<{ [M in keyof MachineMethodParams]: Handler<M> }>;

