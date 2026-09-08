/**
 * Byte-level reading of one already-open, already-validated Knowledge file or
 * directory: whole-buffer reads for `search()`, directory enumeration, and
 * the shared close-then-translate cleanup both rely on.
 */

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
} from './knowledge-filesystem';

const KNOWLEDGE_MAX_READ_CHUNK_BYTES = 64 * 1024;

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

/**
 * Shared `readFile` cleanup: close the opened file (best-effort — a close
 * error only replaces an absent read failure) and translate whatever failure
 * remains into the filesystem's typed error vocabulary. Resolves silently
 * when there is nothing to translate.
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
