/**
 * Byte- and line-level reading of one already-open, already-validated
 * Knowledge file or directory: the streaming line-selection accumulator
 * `read()` bounds itself to, whole-buffer reads for `search()`, the
 * serialized-size budget a read result must fit, and the shared
 * close-then-translate cleanup both paths rely on.
 */

import {
  KNOWLEDGE_MAX_READ_BYTES,
  KNOWLEDGE_MAX_READ_LINES,
} from './knowledge-filesystem-limits';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import {
  closeResource,
  isErrno,
  observe,
  throwIfAborted,
} from './knowledge-filesystem-io';
import type {
  KnowledgeFilesystemDirectory,
  KnowledgeFilesystemDirent,
  KnowledgeFilesystemFile,
  KnowledgeFilesystemReadResult,
  KnowledgeFilesystemStats,
} from './knowledge-filesystem';

const KNOWLEDGE_MAX_READ_CHUNK_BYTES = 64 * 1024;

/** One `readFileLines` request: which file, what range, and the response budget. */
export type KnowledgeReadLinesRequest = {
  readonly filePath: string;
  readonly relativePath: string;
  readonly offset: number;
  readonly requestedLimit: number | undefined;
  readonly maxResultCodeUnits: number;
  readonly fixedResultCodeUnits: number;
};

/** The selection window and response budget a line-read is bounded by. */
export type KnowledgeLineSelectionBudget = Pick<
  KnowledgeReadLinesRequest,
  'offset' | 'requestedLimit' | 'maxResultCodeUnits' | 'fixedResultCodeUnits'
> & { readonly maxLines: number };

export function resolveLineSelectionBudget(
  request: KnowledgeReadLinesRequest,
): KnowledgeLineSelectionBudget {
  const { offset, requestedLimit, maxResultCodeUnits, fixedResultCodeUnits } =
    request;
  return {
    offset,
    requestedLimit,
    maxResultCodeUnits,
    fixedResultCodeUnits,
    maxLines: Math.min(
      requestedLimit ?? KNOWLEDGE_MAX_READ_LINES,
      KNOWLEDGE_MAX_READ_LINES,
    ),
  };
}

/** Mutable line-selection accumulator threaded through readFileLines' decode loop. */
type KnowledgeLineSelectionState = {
  fragments: Array<string>;
  lineIndex: number;
  selectedLines: Array<string>;
  serializedContentCodeUnits: number;
  selectionStorageFull: boolean;
};

function emptyKnowledgeLineSelectionState(): KnowledgeLineSelectionState {
  return {
    fragments: [],
    lineIndex: 0,
    selectedLines: [],
    serializedContentCodeUnits: 0,
    selectionStorageFull: false,
  };
}

/** Record one decoded source line, subject to the offset window and size cap. */
function appendKnowledgeLine(
  state: KnowledgeLineSelectionState,
  budget: KnowledgeLineSelectionBudget,
  sourceLine: string,
  delimiter: string,
): void {
  if (
    state.lineIndex >= budget.offset &&
    state.lineIndex < budget.offset + budget.maxLines &&
    !state.selectionStorageFull
  ) {
    const rendered = `${state.lineIndex + 1}: ${sourceLine}${delimiter}`;
    const renderedCodeUnits = serializedStringLength(rendered);
    if (
      state.serializedContentCodeUnits + renderedCodeUnits >
      budget.maxResultCodeUnits - budget.fixedResultCodeUnits
    ) {
      state.selectionStorageFull = true;
    } else {
      state.selectedLines.push(rendered);
      state.serializedContentCodeUnits += renderedCodeUnits;
    }
  }
  state.lineIndex += 1;
}

/** Split newly-decoded text on `\n`/`\r\n`, carrying a trailing partial line
 * forward in `state.fragments` across chunk boundaries. */
function consumeKnowledgeLineText(
  state: KnowledgeLineSelectionState,
  budget: KnowledgeLineSelectionBudget,
  text: string,
): void {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    if (newline < 0) {
      state.fragments.push(text.slice(start));
      return;
    }
    state.fragments.push(text.slice(start, newline));
    let sourceLine = state.fragments.join('');
    const delimiter = sourceLine.endsWith('\r') ? '\r\n' : '\n';
    if (delimiter === '\r\n') {
      sourceLine = sourceLine.slice(0, -1);
    }
    appendKnowledgeLine(state, budget, sourceLine, delimiter);
    state.fragments.length = 0;
    start = newline + 1;
  }
}

/**
 * Read an already-open, already-validated file's whole content, up to
 * `maxBytes` + 1 (the extra byte lets the caller detect and reject overflow
 * rather than silently truncating).
 */
export async function readWholeFileBytes(
  file: KnowledgeFilesystemFile,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const chunks: Array<Buffer> = [];
  let totalBytes = 0;
  while (totalBytes <= maxBytes) {
    throwIfAborted(signal);
    const buffer = Buffer.allocUnsafe(
      Math.min(KNOWLEDGE_MAX_READ_CHUNK_BYTES, maxBytes + 1 - totalBytes),
    );
    const result = await observe(
      file.read(buffer, 0, buffer.length, totalBytes),
      signal,
    );
    if (
      !Number.isInteger(result.bytesRead) ||
      result.bytesRead < 0 ||
      result.bytesRead > buffer.length
    ) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    if (result.bytesRead === 0) break;
    chunks.push(buffer.subarray(0, result.bytesRead));
    totalBytes += result.bytesRead;
    if (totalBytes > maxBytes) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
  }
  return Buffer.concat(chunks, totalBytes);
}

/** How much of a `readKnowledgeFileLines` read is done, and where it stops. */
type KnowledgeReadProgress = { totalBytes: number; readTarget: number };

/** Read one chunk at `progress.totalBytes`, sized to not overrun a known file length. */
async function readKnowledgeFileChunk(
  file: KnowledgeFilesystemFile,
  progress: KnowledgeReadProgress,
  fileStats: KnowledgeFilesystemStats,
  signal: AbortSignal | undefined,
): Promise<{ bytesRead: number; buffer: Buffer }> {
  const { totalBytes, readTarget } = progress;
  const targetLength = Math.min(
    KNOWLEDGE_MAX_READ_CHUNK_BYTES,
    readTarget - totalBytes,
  );
  const length =
    fileStats.size > 0 && totalBytes < fileStats.size
      ? Math.min(targetLength, fileStats.size - totalBytes)
      : targetLength;
  const buffer = Buffer.allocUnsafe(length);
  const readResult = await observe(
    file.read(buffer, 0, buffer.length, totalBytes),
    signal,
  );
  if (
    !Number.isInteger(readResult.bytesRead) ||
    readResult.bytesRead < 0 ||
    readResult.bytesRead > buffer.length
  ) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
  return { bytesRead: readResult.bytesRead, buffer };
}

/**
 * Read one already-open, already-validated file's bytes into the
 * line-selection accumulator, decoding as UTF-8 and stopping at the
 * read-byte/read-line caps.
 */
export async function readKnowledgeFileLines(
  file: KnowledgeFilesystemFile,
  fileStats: KnowledgeFilesystemStats,
  budget: KnowledgeLineSelectionBudget,
  signal: AbortSignal | undefined,
): Promise<KnowledgeLineSelectionState> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const state = emptyKnowledgeLineSelectionState();
  let totalBytes = 0;
  const hasKnownSize = fileStats.size > 0;
  let readTarget = hasKnownSize
    ? Math.min(KNOWLEDGE_MAX_READ_BYTES + 1, fileStats.size + 1)
    : KNOWLEDGE_MAX_READ_BYTES + 1;

  while (totalBytes < readTarget) {
    throwIfAborted(signal);
    const { bytesRead, buffer } = await readKnowledgeFileChunk(
      file,
      { totalBytes, readTarget },
      fileStats,
      signal,
    );
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > KNOWLEDGE_MAX_READ_BYTES) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
    const decoded = decodeChunk(decoder, buffer, bytesRead);
    consumeKnowledgeLineText(state, budget, decoded);
    if (hasKnownSize && totalBytes > fileStats.size) {
      readTarget = KNOWLEDGE_MAX_READ_BYTES + 1;
    }
  }

  consumeKnowledgeLineText(state, budget, flushDecoder(decoder));
  if (state.fragments.length > 0) {
    appendKnowledgeLine(state, budget, state.fragments.join(''), '');
  }
  return state;
}

/** Decide the final read result, or throw, once the accumulator is complete. */
export function resolveLineSelectionResult(
  state: KnowledgeLineSelectionState,
  budget: KnowledgeLineSelectionBudget,
  path: string,
): KnowledgeFilesystemReadResult {
  const { offset, maxLines, maxResultCodeUnits, fixedResultCodeUnits } = budget;
  if (state.lineIndex === 0 && offset === 0) {
    const emptyResult = { path, offset, lineCount: 0, content: '' };
    if (
      measureReadResultCodeUnits(fixedResultCodeUnits, emptyResult) >
      maxResultCodeUnits
    ) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
    return emptyResult;
  }
  if (offset >= state.lineIndex) {
    throw new KnowledgeFilesystemError('knowledge_range_invalid');
  }
  return selectReadResult({
    path,
    offset,
    requestedLimit: budget.requestedLimit,
    maxLines,
    totalLines: state.lineIndex,
    selectedLines: state.selectedLines,
    maxResultCodeUnits,
    fixedResultCodeUnits,
  });
}

type KnowledgeFilesystemReadResultBuilder = {
  path: string;
  offset: number;
  lineCount: number;
  content: string;
  nextOffset?: number;
  cutReason?: 'line_limit' | 'output_limit';
};

type ReadResultSelection = {
  readonly path: string;
  readonly offset: number;
  readonly requestedLimit: number | undefined;
  readonly maxLines: number;
  readonly totalLines: number;
  readonly selectedLines: ReadonlyArray<string>;
  readonly maxResultCodeUnits: number;
  readonly fixedResultCodeUnits: number;
};

function selectReadResult(
  selection: ReadResultSelection,
): KnowledgeFilesystemReadResult {
  const availableLines = selection.totalLines - selection.offset;
  const requestedLineCount = Math.min(selection.maxLines, availableLines);
  const storedLineCount = Math.min(
    selection.selectedLines.length,
    requestedLineCount,
  );

  for (let lineCount = storedLineCount; lineCount >= 1; lineCount -= 1) {
    const hasRemaining = availableLines > lineCount;
    const result: KnowledgeFilesystemReadResultBuilder = {
      path: selection.path,
      offset: selection.offset,
      lineCount,
      content: selection.selectedLines.slice(0, lineCount).join(''),
    };
    if (hasRemaining) result.nextOffset = selection.offset + lineCount;
    if (hasRemaining && lineCount < requestedLineCount) {
      result.cutReason = 'output_limit';
    } else if (
      hasRemaining &&
      selection.requestedLimit === undefined &&
      availableLines > selection.maxLines
    ) {
      result.cutReason = 'line_limit';
    }
    if (
      measureReadResultCodeUnits(selection.fixedResultCodeUnits, result) <=
      selection.maxResultCodeUnits
    ) {
      return result;
    }
  }

  throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
}

function measureReadResultCodeUnits(
  fixedResultCodeUnits: number,
  result: KnowledgeFilesystemReadResult,
): number {
  let codeUnits = fixedResultCodeUnits;
  codeUnits += serializedPropertyCodeUnits('lineCount', result.lineCount);
  codeUnits += serializedPropertyCodeUnits('content', result.content);
  if (result.nextOffset !== undefined) {
    codeUnits += serializedPropertyCodeUnits('nextOffset', result.nextOffset);
  }
  if (result.cutReason !== undefined) {
    codeUnits += serializedPropertyCodeUnits('cutReason', result.cutReason);
  }
  return codeUnits;
}

function decodeChunk(
  decoder: TextDecoder,
  buffer: Buffer,
  bytesRead: number,
): string {
  try {
    return decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
  } catch {
    throw new KnowledgeFilesystemError('knowledge_content_invalid');
  }
}

function flushDecoder(decoder: TextDecoder): string {
  try {
    return decoder.decode();
  } catch {
    throw new KnowledgeFilesystemError('knowledge_content_invalid');
  }
}

function serializedStringLength(value: string): number {
  return JSON.stringify(value).length - 2;
}

export function serializedFixedReadResultLength(value: {
  readonly path: string;
  readonly offset: number;
}): number {
  return JSON.stringify(value).length;
}

function serializedScalarLength(value: string | number): number {
  return JSON.stringify(value).length;
}

function serializedPropertyCodeUnits(
  key: string,
  value: string | number,
): number {
  return 1 + serializedScalarLength(key) + 1 + serializedScalarLength(value);
}

/**
 * Shared `readFile`/`readFileLines` cleanup: close the opened file
 * (best-effort — a close error only replaces an absent read failure) and
 * translate whatever failure remains into the filesystem's typed error
 * vocabulary. Resolves silently when there is nothing to translate.
 */
export async function closeFileAndTranslateFailure(
  file: KnowledgeFilesystemFile | undefined,
  error: unknown,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (file !== undefined) {
    try {
      await closeResource(file, signal);
    } catch (closeError) {
      error ??= closeError;
    }
  }
  if (error instanceof KnowledgeFilesystemError) {
    throw error;
  }
  if (isErrno(error, 'ENOENT')) {
    throw new KnowledgeFilesystemError('knowledge_not_found');
  }
  if (isErrno(error, 'ELOOP')) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  if (error !== undefined) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
}

/** Enumerate every entry in an already-open directory, bounded by `remainingEntries`. */
export async function readAllDirectoryEntries(
  directory: KnowledgeFilesystemDirectory,
  remainingEntries: number,
  signal: AbortSignal | undefined,
): Promise<Array<KnowledgeFilesystemDirent>> {
  const entries: Array<KnowledgeFilesystemDirent> = [];
  while (true) {
    throwIfAborted(signal);
    const entry = await observe(directory.read(), signal);
    if (entry === null) break;
    entries.push(entry);
    if (entries.length > remainingEntries) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
  }
  return entries;
}

/**
 * Shared `readDirectory` cleanup: close the opened directory (best-effort —
 * a close error only replaces an absent enumeration failure) and translate
 * whatever failure remains. Unlike the file variant, an unexpected ENOENT
 * here means the directory vanished mid-read, not a normal not-found.
 */
export async function closeDirectoryAndTranslateFailure(
  directory: KnowledgeFilesystemDirectory | undefined,
  error: unknown,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (directory !== undefined) {
    try {
      await closeResource(directory, signal);
    } catch (closeError) {
      error ??= closeError;
    }
  }
  if (error instanceof KnowledgeFilesystemError) {
    throw error;
  }
  if (isErrno(error, 'ENOENT')) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
  if (error !== undefined) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
}
