import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

import { isRecord, isString } from '../unknown-record';

export const KNOWLEDGE_MAX_ENTRIES = 20_000;
export const KNOWLEDGE_MAX_FILES = 5_000;
export const KNOWLEDGE_MAX_SEARCH_FILE_BYTES = 1 * 1024 * 1024;
export const KNOWLEDGE_MAX_SEARCH_BYTES = 32 * 1024 * 1024;
export const KNOWLEDGE_MAX_READ_BYTES = 1 * 1024 * 1024;
export const KNOWLEDGE_MAX_READ_LINES = 2_000;
export const KNOWLEDGE_MAX_PATH_BYTES = 1_024;
export const KNOWLEDGE_MAX_PATH_COMPONENTS = 32;
export const KNOWLEDGE_MAX_SNIPPET_CODE_POINTS = 500;

const SPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKDOWN_SUFFIX = '.md';
const KNOWLEDGE_MAX_READ_CHUNK_BYTES = 64 * 1024;

export type KnowledgeFilesystemBinding = {
  readonly id: string;
  /** Present on database-backed bindings; legacy test/adaptor callers may omit it. */
  readonly name?: string;
  readonly root: string;
  readonly directory: string;
};

/** Mutable operation-wide accounting shared by every targeted space. */
export type KnowledgeFilesystemSearchBudget = {
  remainingEntries: number;
  remainingFiles: number;
  remainingBytes: number;
};

export function createKnowledgeFilesystemSearchBudget(): KnowledgeFilesystemSearchBudget {
  return {
    remainingEntries: KNOWLEDGE_MAX_ENTRIES,
    remainingFiles: KNOWLEDGE_MAX_FILES,
    remainingBytes: KNOWLEDGE_MAX_SEARCH_BYTES,
  };
}

export type KnowledgeFilesystemStats = {
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

export type KnowledgeFilesystemDirent = {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

export type KnowledgeFilesystemDirectory = {
  read(): Promise<KnowledgeFilesystemDirent | null>;
  close(): Promise<void>;
};

export type KnowledgeFilesystemFile = {
  stat(): Promise<KnowledgeFilesystemStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
};

export type KnowledgeFilesystemPort = {
  lstat(filePath: string): Promise<KnowledgeFilesystemStats>;
  opendir(directoryPath: string): Promise<KnowledgeFilesystemDirectory>;
  open(filePath: string): Promise<KnowledgeFilesystemFile>;
  realpath(filePath: string): Promise<string>;
};

const NODE_FILESYSTEM: KnowledgeFilesystemPort = {
  lstat: (filePath) => fs.lstat(filePath),
  opendir: (directoryPath) => fs.opendir(directoryPath),
  open: async (filePath) => {
    const handle = await fs.open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    return {
      stat: async () => {
        const stats = await handle.stat();
        return {
          size: stats.size,
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
          isSymbolicLink: () => stats.isSymbolicLink(),
        };
      },
      read: async (buffer, offset, length, position) => {
        const result = await handle.read(buffer, offset, length, position);
        return { bytesRead: result.bytesRead };
      },
      close: () => handle.close(),
    };
  },
  realpath: (filePath) => fs.realpath(filePath),
};

export type KnowledgeFilesystemErrorCode =
  | 'knowledge_path_invalid'
  | 'knowledge_not_found'
  | 'knowledge_range_invalid'
  | 'knowledge_content_invalid'
  | 'knowledge_limit_exceeded'
  | 'knowledge_space_unavailable'
  | 'knowledge_cancelled';

export class KnowledgeFilesystemError extends Error {
  constructor(readonly code: KnowledgeFilesystemErrorCode) {
    super(messageFor(code));
    this.name = 'KnowledgeFilesystemError';
  }
}

export type KnowledgeFilesystemSearchMatch = {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
  readonly excerpt: string;
};

export type KnowledgeFilesystemReadResult = {
  readonly path: string;
  readonly offset: number;
  readonly lineCount: number;
  readonly content: string;
  readonly nextOffset?: number;
  readonly cutReason?: 'line_limit' | 'output_limit';
};

type KnowledgeFilesystemReadResultBuilder = {
  path: string;
  offset: number;
  lineCount: number;
  content: string;
  nextOffset?: number;
  cutReason?: 'line_limit' | 'output_limit';
};

export type KnowledgeFilesystemAdapterPort = Pick<
  KnowledgeFilesystemAdapter,
  'search' | 'read'
>;

export type KnowledgeFilesystemSearchOptions = {
  readonly signal?: AbortSignal;
  readonly budget?: KnowledgeFilesystemSearchBudget;
  readonly after?: KnowledgeFilesystemSearchAfter;
  readonly maxResults?: number;
};

export type KnowledgeFilesystemSearchAfter = {
  readonly path: string;
  readonly offset: number;
};

export type KnowledgeFilesystemPassageOptions = {
  readonly signal?: AbortSignal;
  readonly after?: KnowledgeFilesystemSearchAfter;
  readonly maxResults?: number;
};

export type KnowledgeFilesystemReadOptions =
  KnowledgeFilesystemSearchOptions & {
    readonly offset?: number;
    readonly limit?: number;
    /** Internal serialized-result budget, expressed in UTF-16 code units. */
    readonly maxResultCodeUnits?: number;
    /** Serialized size of the result fields fixed before the read starts. */
    readonly fixedResultCodeUnits?: number;
  };
type DirectoryReadResult = {
  readonly entries: KnowledgeFilesystemDirent[];
  readonly count: number;
};

/**
 * Bounded, live filesystem access for one trusted Knowledge Space binding.
 * This class deliberately knows nothing about owners, PostgreSQL, Git, or
 * caller-selected roots. Its binding is the output of the trusted resolver.
 */
export class KnowledgeFilesystemAdapter {
  constructor(
    private readonly binding: KnowledgeFilesystemBinding,
    private readonly fileSystem: KnowledgeFilesystemPort = NODE_FILESYSTEM,
  ) {}

  async search(
    query: string,
    limit: number,
    options: KnowledgeFilesystemSearchOptions = {},
  ): Promise<KnowledgeFilesystemSearchMatch[]> {
    validateSearchInput(query, limit);
    const signal = options.signal;
    const budget = options.budget ?? createKnowledgeFilesystemSearchBudget();
    const directory = await this.resolveBindingDirectory(signal);
    const matches: KnowledgeFilesystemSearchMatch[] = [];
    const maxResults = options.maxResults ?? limit;
    const pending = [{ absolutePath: directory, relativePath: '' }];

    while (pending.length > 0) {
      throwIfAborted(signal);
      const current = pending.pop()!;
      const directoryResult = await this.readDirectory(
        current.absolutePath,
        budget.remainingEntries,
        signal,
      );
      budget.remainingEntries -= directoryResult.count;
      const entries = directoryResult.entries;
      entries.sort((left, right) => compareNames(left.name, right.name));

      for (const entry of entries) {
        throwIfAborted(signal);
        const relativePath = joinRelativePath(current.relativePath, entry.name);
        const components = validatePath(relativePath, false);
        const absolutePath = path.join(directory, ...components);
        const stats = await this.lstat(
          absolutePath,
          'knowledge_space_unavailable',
          signal,
        );
        if (stats.isSymbolicLink() || entry.isSymbolicLink()) {
          throw new KnowledgeFilesystemError('knowledge_path_invalid');
        }
        if (stats.isDirectory()) {
          pending.push({ absolutePath, relativePath });
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }
        if (!isMarkdownPath(relativePath)) {
          continue;
        }
        if (budget.remainingFiles <= 0) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        budget.remainingFiles -= 1;
        if (stats.size > KNOWLEDGE_MAX_SEARCH_FILE_BYTES) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        if (stats.size > budget.remainingBytes) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }

        const bytes = await this.readFile(
          absolutePath,
          Math.min(KNOWLEDGE_MAX_SEARCH_FILE_BYTES, budget.remainingBytes),
          signal,
        );
        if (bytes.length > KNOWLEDGE_MAX_SEARCH_FILE_BYTES) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        if (bytes.length > budget.remainingBytes) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        budget.remainingBytes -= bytes.length;
        const text = decodeUtf8(bytes);
        const fileMatches = await collectKnowledgePassages(
          relativePath,
          text,
          query,
          { signal, after: options.after, maxResults },
        );
        for (const match of fileMatches) {
          matches.push(match);
          matches.sort(compareSearchMatches);
          if (matches.length > maxResults) matches.pop();
        }
      }
    }

    return matches.sort(compareSearchMatches);
  }

  async read(
    relativePath: string,
    options: KnowledgeFilesystemReadOptions = {},
  ): Promise<KnowledgeFilesystemReadResult> {
    const components = validatePath(relativePath, true);
    validateReadRange(options.offset, options.limit);
    const signal = options.signal;
    const directory = await this.resolveBindingDirectory(signal);
    let current = directory;
    let remainingEntries = KNOWLEDGE_MAX_ENTRIES;

    for (const [index, component] of components.entries()) {
      throwIfAborted(signal);
      const directoryResult = await this.readDirectory(
        current,
        remainingEntries,
        signal,
      );
      remainingEntries -= directoryResult.count;
      const entries = directoryResult.entries;
      const entry = entries.find((candidate) => candidate.name === component);
      if (entry === undefined) {
        throw new KnowledgeFilesystemError('knowledge_not_found');
      }
      current = path.join(current, component);
      const stats = await this.lstat(current, 'knowledge_not_found', signal);
      if (stats.isSymbolicLink() || entry.isSymbolicLink()) {
        throw new KnowledgeFilesystemError('knowledge_path_invalid');
      }
      if (index < components.length - 1 && !stats.isDirectory()) {
        throw new KnowledgeFilesystemError('knowledge_not_found');
      }
      if (index === components.length - 1 && !stats.isFile()) {
        throw new KnowledgeFilesystemError('knowledge_not_found');
      }
    }

    const stats = await this.lstat(current, 'knowledge_not_found', signal);
    if (stats.size > KNOWLEDGE_MAX_READ_BYTES) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
    const offset = options.offset ?? 0;
    return this.readFileLines(
      current,
      relativePath,
      offset,
      options.limit,
      options.maxResultCodeUnits ?? 15_000,
      options.fixedResultCodeUnits ??
        serializedFixedReadResultLength({ path: relativePath, offset }),
      signal,
    );
  }

  private async resolveBindingDirectory(
    signal: AbortSignal | undefined,
  ): Promise<string> {
    validateBinding(this.binding);
    const root = path.resolve(this.binding.root);
    const directory = path.resolve(this.binding.directory);
    const expectedDirectory = path.join(root, this.binding.id);
    if (directory !== expectedDirectory) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }

    const rootStats = await this.lstat(
      root,
      'knowledge_space_unavailable',
      signal,
    );
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    const canonicalRoot = await this.realpath(root, signal);
    if (canonicalRoot !== root) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }

    const childStats = await this.lstat(
      directory,
      'knowledge_space_unavailable',
      signal,
    );
    if (childStats.isSymbolicLink() || !childStats.isDirectory()) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    const canonicalDirectory = await this.realpath(directory, signal);
    if (canonicalDirectory !== directory) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    return directory;
  }

  private async readDirectory(
    directoryPath: string,
    remainingEntries: number,
    signal: AbortSignal | undefined,
  ): Promise<DirectoryReadResult> {
    const stats = await this.lstat(
      directoryPath,
      'knowledge_space_unavailable',
      signal,
    );
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new KnowledgeFilesystemError('knowledge_path_invalid');
    }
    let directory: KnowledgeFilesystemDirectory | undefined;
    let failure: unknown;
    let entries: KnowledgeFilesystemDirent[] | undefined;
    try {
      directory = await observeResource(
        () => this.fileSystem.opendir(directoryPath),
        signal,
      );
      entries = [];
      while (true) {
        throwIfAborted(signal);
        const entry = await observe(directory.read(), signal);
        if (entry === null) break;
        entries.push(entry);
        if (entries.length > remainingEntries) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
      }
    } catch (error) {
      failure = error;
    }
    if (directory !== undefined) {
      try {
        await closeResource(directory, signal);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure instanceof KnowledgeFilesystemError) {
      throw failure;
    }
    if (isErrno(failure, 'ENOENT')) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    if (failure !== undefined) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    return { entries: entries ?? [], count: entries?.length ?? 0 };
  }

  private async lstat(
    filePath: string,
    missingCode: KnowledgeFilesystemErrorCode,
    signal: AbortSignal | undefined,
  ): Promise<KnowledgeFilesystemStats> {
    try {
      return await observe(this.fileSystem.lstat(filePath), signal);
    } catch (error) {
      if (error instanceof KnowledgeFilesystemError) throw error;
      if (isErrno(error, 'ENOENT')) {
        throw new KnowledgeFilesystemError(missingCode);
      }
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
  }

  private async readFile(
    filePath: string,
    maxBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<Buffer> {
    let file: KnowledgeFilesystemFile | undefined;
    let failure: unknown;
    let bytes: Buffer | undefined;
    try {
      file = await observeResource(
        () => this.fileSystem.open(filePath),
        signal,
      );
      const fileStats = await observe(file.stat(), signal);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        throw new KnowledgeFilesystemError('knowledge_path_invalid');
      }
      if (fileStats.size > maxBytes) {
        throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
      }
      const chunks: Buffer[] = [];
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
      bytes = Buffer.concat(chunks, totalBytes);
    } catch (error) {
      failure = error;
    }
    if (file !== undefined) {
      try {
        await closeResource(file, signal);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure instanceof KnowledgeFilesystemError) {
      throw failure;
    }
    if (isErrno(failure, 'ENOENT')) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
    if (isErrno(failure, 'ELOOP')) {
      throw new KnowledgeFilesystemError('knowledge_path_invalid');
    }
    if (failure !== undefined) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    return bytes ?? Buffer.alloc(0);
  }

  private async readFileLines(
    filePath: string,
    relativePath: string,
    offset: number,
    requestedLimit: number | undefined,
    maxResultCodeUnits: number,
    fixedResultCodeUnits: number,
    signal: AbortSignal | undefined,
  ): Promise<KnowledgeFilesystemReadResult> {
    let file: KnowledgeFilesystemFile | undefined;
    let failure: unknown;
    let result: KnowledgeFilesystemReadResult | undefined;
    try {
      file = await observeResource(
        () => this.fileSystem.open(filePath),
        signal,
      );
      const fileStats = await observe(file.stat(), signal);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        throw new KnowledgeFilesystemError('knowledge_path_invalid');
      }
      if (fileStats.size > KNOWLEDGE_MAX_READ_BYTES) {
        throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
      }

      const decoder = new TextDecoder('utf-8', { fatal: true });
      const maxLines = Math.min(
        requestedLimit ?? KNOWLEDGE_MAX_READ_LINES,
        KNOWLEDGE_MAX_READ_LINES,
      );
      const fragments: string[] = [];
      let totalBytes = 0;
      const hasKnownSize = fileStats.size > 0;
      let readTarget = hasKnownSize
        ? Math.min(KNOWLEDGE_MAX_READ_BYTES + 1, fileStats.size + 1)
        : KNOWLEDGE_MAX_READ_BYTES + 1;
      let lineIndex = 0;
      const selectedLines: string[] = [];
      let serializedContentCodeUnits = 0;
      let selectionStorageFull = false;

      const appendLine = (sourceLine: string, delimiter: string): void => {
        if (
          lineIndex >= offset &&
          lineIndex < offset + maxLines &&
          !selectionStorageFull
        ) {
          const rendered = `${lineIndex + 1}: ${sourceLine}${delimiter}`;
          const renderedCodeUnits = serializedStringLength(rendered);
          if (
            serializedContentCodeUnits + renderedCodeUnits >
            maxResultCodeUnits - fixedResultCodeUnits
          ) {
            selectionStorageFull = true;
          } else {
            selectedLines.push(rendered);
            serializedContentCodeUnits += renderedCodeUnits;
          }
        }
        lineIndex += 1;
      };

      const consumeText = (text: string): void => {
        let start = 0;
        while (start < text.length) {
          const newline = text.indexOf('\n', start);
          if (newline < 0) {
            fragments.push(text.slice(start));
            return;
          }
          fragments.push(text.slice(start, newline));
          let sourceLine = fragments.join('');
          const delimiter = sourceLine.endsWith('\r') ? '\r\n' : '\n';
          if (delimiter === '\r\n') {
            sourceLine = sourceLine.slice(0, -1);
          }
          appendLine(sourceLine, delimiter);
          fragments.length = 0;
          start = newline + 1;
        }
      };

      while (totalBytes < readTarget) {
        throwIfAborted(signal);
        const targetLength = Math.min(
          KNOWLEDGE_MAX_READ_CHUNK_BYTES,
          readTarget - totalBytes,
        );
        const length =
          hasKnownSize && totalBytes < fileStats.size
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
        if (readResult.bytesRead === 0) break;
        totalBytes += readResult.bytesRead;
        if (totalBytes > KNOWLEDGE_MAX_READ_BYTES) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        consumeText(decodeChunk(decoder, buffer, readResult.bytesRead));
        if (hasKnownSize && totalBytes > fileStats.size) {
          readTarget = KNOWLEDGE_MAX_READ_BYTES + 1;
        }
      }

      consumeText(flushDecoder(decoder));
      if (fragments.length > 0) {
        appendLine(fragments.join(''), '');
      }

      if (lineIndex === 0 && offset === 0) {
        const emptyResult = {
          path: relativePath,
          offset,
          lineCount: 0,
          content: '',
        };
        if (
          measureReadResultCodeUnits(fixedResultCodeUnits, emptyResult) >
          maxResultCodeUnits
        ) {
          throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
        }
        result = emptyResult;
      } else if (offset >= lineIndex) {
        throw new KnowledgeFilesystemError('knowledge_range_invalid');
      } else {
        result = selectReadResult({
          path: relativePath,
          offset,
          requestedLimit,
          maxLines,
          totalLines: lineIndex,
          selectedLines,
          maxResultCodeUnits,
          fixedResultCodeUnits,
        });
      }
    } catch (error) {
      failure = error;
    }
    if (file !== undefined) {
      try {
        await closeResource(file, signal);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure instanceof KnowledgeFilesystemError) {
      throw failure;
    }
    if (isErrno(failure, 'ENOENT')) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
    if (isErrno(failure, 'ELOOP')) {
      throw new KnowledgeFilesystemError('knowledge_path_invalid');
    }
    if (failure !== undefined) {
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
    return (
      result ?? {
        path: relativePath,
        offset,
        lineCount: 0,
        content: '',
      }
    );
  }

  private async realpath(
    filePath: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    try {
      return await observe(this.fileSystem.realpath(filePath), signal);
    } catch (error) {
      if (error instanceof KnowledgeFilesystemError) throw error;
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
  }
}

type ReadResultSelection = {
  readonly path: string;
  readonly offset: number;
  readonly requestedLimit: number | undefined;
  readonly maxLines: number;
  readonly totalLines: number;
  readonly selectedLines: readonly string[];
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

function messageFor(code: KnowledgeFilesystemErrorCode): string {
  switch (code) {
    case 'knowledge_path_invalid':
      return 'The Knowledge path is invalid.';
    case 'knowledge_not_found':
      return 'The Knowledge note was not found.';
    case 'knowledge_range_invalid':
      return 'The Knowledge line range is invalid.';
    case 'knowledge_content_invalid':
      return 'The Knowledge note is not valid UTF-8.';
    case 'knowledge_limit_exceeded':
      return 'The Knowledge operation exceeded its limit.';
    case 'knowledge_space_unavailable':
      return 'The Knowledge Space is unavailable.';
    case 'knowledge_cancelled':
      return 'The Knowledge operation was cancelled.';
  }
}

function validateBinding(binding: KnowledgeFilesystemBinding): void {
  if (
    !SPACE_ID_PATTERN.test(binding.id) ||
    !path.isAbsolute(binding.root) ||
    !path.isAbsolute(binding.directory)
  ) {
    throw new KnowledgeFilesystemError('knowledge_space_unavailable');
  }
}

function validateSearchInput(query: string, limit: number): void {
  if (query.length === 0) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  if (
    Array.from(query).length > 200 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10
  ) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
}

function validateReadRange(
  offset: number | undefined,
  limit: number | undefined,
): void {
  if (
    (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) ||
    (limit !== undefined &&
      (!Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > KNOWLEDGE_MAX_READ_LINES))
  ) {
    throw new KnowledgeFilesystemError('knowledge_range_invalid');
  }
}

function validatePath(
  relativePath: string,
  requireMarkdown: boolean,
): string[] {
  if (
    relativePath.length === 0 ||
    containsControlCharacter(relativePath) ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }

  const components = relativePath.split('/');
  if (
    components.some(
      (component) =>
        component === '' || component === '.' || component === '..',
    )
  ) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  const byteLength = Buffer.byteLength(relativePath, 'utf8');
  if (
    byteLength > KNOWLEDGE_MAX_PATH_BYTES ||
    components.length > KNOWLEDGE_MAX_PATH_COMPONENTS
  ) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
  if (requireMarkdown && !isMarkdownPath(relativePath)) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  return components;
}

function isMarkdownPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(MARKDOWN_SUFFIX);
}

function joinRelativePath(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent}/${name}`;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeFilesystemError('knowledge_content_invalid');
  }
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

function serializedFixedReadResultLength(value: {
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

type KnowledgeLogicalLine = {
  readonly line: number;
  readonly text: string;
  readonly delimiter: string;
};

type KnowledgeSearchOccurrence = {
  readonly line: number;
  readonly offset: number;
  readonly length: number;
};

type KnowledgeSearchActiveInterval = {
  start: number;
  end: number;
  partitionStart: number;
  partitionLines: KnowledgeLogicalLine[];
  partitionFirstOccurrence?: KnowledgeSearchOccurrence;
  lastOccurrence: KnowledgeSearchOccurrence;
  lookahead: KnowledgeLogicalLine[];
};

/**
 * Bounded passage extraction shared by the live adapter and focused unit tests.
 * Logical lines intentionally match the ranged reader: only LF terminates a
 * line, and a preceding CR belongs to that delimiter as CRLF.
 */
export async function collectKnowledgePassages(
  relativePath: string,
  text: string,
  query: string,
  options: KnowledgeFilesystemPassageOptions = {},
): Promise<KnowledgeFilesystemSearchMatch[]> {
  const queryFolded = query.toLowerCase();
  if (queryFolded.length === 0) return [];

  const passages: KnowledgeFilesystemSearchMatch[] = [];
  const maxResults = options.maxResults ?? Number.POSITIVE_INFINITY;
  let previousLine: KnowledgeLogicalLine | undefined;
  let active: KnowledgeSearchActiveInterval | undefined;
  let lastLine = -1;

  for await (const line of iterateKnowledgeLogicalLines(text, options.signal)) {
    lastLine = line.line;
    const match = findLineOccurrence(line.text, queryFolded);
    const occurrence =
      match === undefined ? undefined : { line: line.line, ...match };

    if (active === undefined) {
      if (occurrence !== undefined) {
        active = startKnowledgeSearchInterval(line, previousLine, occurrence);
      }
      previousLine = line;
      continue;
    }

    if (occurrence !== undefined) {
      if (line.line <= active.end + 2) {
        appendKnowledgeSearchLookahead(active);
        appendKnowledgeSearchLine(active, line);
        active.end = Math.max(active.end, line.line + 1);
        active.lastOccurrence = occurrence;
        if (line.line > active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1) {
          splitKnowledgeSearchPartition(
            active,
            occurrence,
            relativePath,
            passages,
            options.after,
            maxResults,
          );
        } else if (active.partitionFirstOccurrence === undefined) {
          active.partitionFirstOccurrence = occurrence;
        }
      } else {
        emitFinalKnowledgeSearchPartition(
          active,
          active.end,
          relativePath,
          passages,
          options.after,
          maxResults,
        );
        active = startKnowledgeSearchInterval(line, previousLine, occurrence);
      }
    } else if (line.line <= active.end) {
      appendKnowledgeSearchLine(active, line);
    } else {
      active.lookahead.push(line);
      if (line.line > active.end + 2) {
        emitFinalKnowledgeSearchPartition(
          active,
          active.end,
          relativePath,
          passages,
          options.after,
          maxResults,
        );
        active = undefined;
      }
    }
    previousLine = line;
  }

  if (active !== undefined) {
    emitFinalKnowledgeSearchPartition(
      active,
      Math.min(active.end, lastLine),
      relativePath,
      passages,
      options.after,
      maxResults,
    );
  }

  return passages;
}

function startKnowledgeSearchInterval(
  line: KnowledgeLogicalLine,
  previousLine: KnowledgeLogicalLine | undefined,
  occurrence: KnowledgeSearchOccurrence,
): KnowledgeSearchActiveInterval {
  const start = Math.max(0, line.line - 1);
  const partitionLines =
    previousLine?.line === start ? [previousLine, line] : [line];
  return {
    start,
    end: line.line + 1,
    partitionStart: start,
    partitionLines,
    partitionFirstOccurrence: occurrence,
    lastOccurrence: occurrence,
    lookahead: [],
  };
}

function appendKnowledgeSearchLookahead(
  active: KnowledgeSearchActiveInterval,
): void {
  for (const line of active.lookahead) {
    appendKnowledgeSearchLine(active, line);
  }
  active.lookahead.length = 0;
}

function appendKnowledgeSearchLine(
  active: KnowledgeSearchActiveInterval,
  line: KnowledgeLogicalLine,
): void {
  if (line.line >= active.partitionStart) {
    active.partitionLines.push(line);
  }
}

function findLineOccurrence(
  line: string,
  queryFolded: string,
): Omit<KnowledgeSearchOccurrence, 'line'> | undefined {
  const folded = line.toLowerCase();
  const matchOffset = folded.indexOf(queryFolded);
  if (matchOffset < 0) return undefined;
  const sourceOffset = codePointOffsetForFoldedOffset(line, matchOffset);
  const sourceEnd = codePointOffsetForFoldedOffset(
    line,
    matchOffset + queryFolded.length,
  );
  return {
    offset: sourceOffset,
    length: Math.max(1, sourceEnd - sourceOffset),
  };
}

function makePassageExcerpt(
  lines: readonly KnowledgeLogicalLine[],
  partitionStart: number,
  occurrence: KnowledgeSearchOccurrence,
): string {
  const source = lines.map((line) => `${line.text}${line.delimiter}`).join('');
  const codePoints = Array.from(source);
  if (codePoints.length <= KNOWLEDGE_MAX_SNIPPET_CODE_POINTS) return source;

  let matchStart = 0;
  const occurrenceIndex = occurrence.line - partitionStart;
  for (const line of lines.slice(0, occurrenceIndex)) {
    matchStart += Array.from(`${line.text}${line.delimiter}`).length;
  }
  matchStart += occurrence.offset;
  const matchEnd = matchStart + occurrence.length;
  const visibleLength = KNOWLEDGE_MAX_SNIPPET_CODE_POINTS - 2;
  let windowStart = Math.max(0, matchStart - Math.floor(visibleLength / 2));
  let windowEnd = Math.min(codePoints.length, windowStart + visibleLength);
  if (windowEnd < matchEnd) {
    windowStart = Math.max(0, matchEnd - visibleLength);
    windowEnd = Math.min(codePoints.length, windowStart + visibleLength);
  }
  if (windowEnd - windowStart < visibleLength) {
    windowStart = Math.max(0, windowEnd - visibleLength);
  }
  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < codePoints.length ? '…' : '';
  return `${prefix}${codePoints.slice(windowStart, windowEnd).join('')}${suffix}`;
}

function emitFinalKnowledgeSearchPartition(
  active: KnowledgeSearchActiveInterval,
  finalEnd: number,
  relativePath: string,
  passages: KnowledgeFilesystemSearchMatch[],
  after: KnowledgeFilesystemSearchAfter | undefined,
  maxResults: number,
): void {
  const end = Math.min(active.end, finalEnd);
  if (end < active.partitionStart) return;
  const length = end - active.partitionStart + 1;
  if (length <= KNOWLEDGE_MAX_READ_LINES) {
    appendKnowledgeSearchPassage(
      active.partitionLines.slice(0, length),
      active.partitionStart,
      active.partitionFirstOccurrence,
      relativePath,
      passages,
      after,
      maxResults,
    );
    return;
  }

  const boundary = Math.min(
    active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1,
    active.lastOccurrence.line - 1,
  );
  const firstLength = boundary - active.partitionStart + 1;
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(0, firstLength),
    active.partitionStart,
    active.partitionFirstOccurrence,
    relativePath,
    passages,
    after,
    maxResults,
  );
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(firstLength, length),
    boundary + 1,
    active.lastOccurrence,
    relativePath,
    passages,
    after,
    maxResults,
  );
}

function splitKnowledgeSearchPartition(
  active: KnowledgeSearchActiveInterval,
  nextOccurrence: KnowledgeSearchOccurrence,
  relativePath: string,
  passages: KnowledgeFilesystemSearchMatch[],
  after: KnowledgeFilesystemSearchAfter | undefined,
  maxResults: number,
): void {
  const boundary = active.partitionStart + KNOWLEDGE_MAX_READ_LINES - 1;
  const prefixLength = boundary - active.partitionStart + 1;
  appendKnowledgeSearchPassage(
    active.partitionLines.slice(0, prefixLength),
    active.partitionStart,
    active.partitionFirstOccurrence,
    relativePath,
    passages,
    after,
    maxResults,
  );
  active.partitionStart = boundary + 1;
  active.partitionLines = active.partitionLines.slice(prefixLength);
  active.partitionFirstOccurrence = nextOccurrence;
}

function appendKnowledgeSearchPassage(
  lines: readonly KnowledgeLogicalLine[],
  offset: number,
  occurrence: KnowledgeSearchOccurrence | undefined,
  relativePath: string,
  passages: KnowledgeFilesystemSearchMatch[],
  after: KnowledgeFilesystemSearchAfter | undefined,
  maxResults: number,
): void {
  if (
    occurrence === undefined ||
    !isAfterSearchCursor(
      { path: relativePath, offset, limit: lines.length, excerpt: '' },
      after,
    ) ||
    passages.length >= maxResults
  ) {
    return;
  }
  passages.push({
    path: relativePath,
    offset,
    limit: lines.length,
    excerpt: makePassageExcerpt(lines, offset, occurrence),
  });
}

async function* iterateKnowledgeLogicalLines(
  text: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<KnowledgeLogicalLine> {
  let lineStart = 0;
  let line = 0;
  let scannedCodeUnits = 0;
  for (let index = 0; index < text.length; index += 1) {
    scannedCodeUnits += 1;
    if (scannedCodeUnits % 65_536 === 0) {
      await yieldKnowledgeSearch(signal);
    }
    if (text.charCodeAt(index) !== 10) continue;
    const hasCr = index > lineStart && text.charCodeAt(index - 1) === 13;
    yield {
      line: line++,
      text: text.slice(lineStart, hasCr ? index - 1 : index),
      delimiter: hasCr ? '\r\n' : '\n',
    };
    if (line % 256 === 0) {
      await yieldKnowledgeSearch(signal);
    }
    lineStart = index + 1;
  }
  if (lineStart < text.length) {
    yield { line: line, text: text.slice(lineStart), delimiter: '' };
  }
  throwIfAborted(signal);
}

async function yieldKnowledgeSearch(
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
}

function isAfterSearchCursor(
  match: KnowledgeFilesystemSearchMatch,
  after: KnowledgeFilesystemSearchAfter | undefined,
): boolean {
  if (after === undefined) return true;
  return (
    compareNames(match.path, after.path) > 0 ||
    (match.path === after.path && match.offset > after.offset)
  );
}

function compareSearchMatches(
  left: KnowledgeFilesystemSearchMatch,
  right: KnowledgeFilesystemSearchMatch,
): number {
  const pathOrder = compareNames(left.path, right.path);
  return pathOrder !== 0 ? pathOrder : left.offset - right.offset;
}

function codePointOffsetForFoldedOffset(
  value: string,
  foldedOffset: number,
): number {
  let foldedCodeUnits = 0;
  let codePoints = 0;
  for (const character of value) {
    if (foldedCodeUnits >= foldedOffset) break;
    foldedCodeUnits += character.toLowerCase().length;
    codePoints += 1;
  }
  return codePoints;
}

function containsControlCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
}

async function observe<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) {
    void promise.catch(() => undefined);
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new KnowledgeFilesystemError('knowledge_cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function observeResource<T extends { close(): Promise<void> }>(
  factory: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  const promise = factory();
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(new KnowledgeFilesystemError('knowledge_cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (resource) => {
        signal.removeEventListener('abort', onAbort);
        if (aborted) {
          void resource.close().catch(() => undefined);
          return;
        }
        resolve(resource);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function closeResource(
  resource: { close(): Promise<void> },
  signal: AbortSignal | undefined,
): Promise<void> {
  let failed = false;
  let failure: unknown;
  try {
    await resource.close();
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (signal?.aborted) {
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
  if (failed) throw failure;
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && isString(error['code']) && error['code'] === code;
}
