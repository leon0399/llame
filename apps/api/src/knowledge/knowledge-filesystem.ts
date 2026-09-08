import path from 'node:path';

import {
  KNOWLEDGE_MAX_ENTRIES,
  KNOWLEDGE_MAX_FILES,
  KNOWLEDGE_MAX_SEARCH_BYTES,
  KNOWLEDGE_MAX_SEARCH_FILE_BYTES,
} from './knowledge-filesystem-limits';
import {
  KnowledgeFilesystemError,
  type KnowledgeFilesystemErrorCode,
} from './knowledge-filesystem-errors';
import {
  isErrno,
  observe,
  observeResource,
  throwIfAborted,
} from './knowledge-filesystem-io';
import {
  compareNames,
  compareSearchMatches,
  collectKnowledgePassages,
  decodeUtf8,
} from './knowledge-filesystem-search';
import {
  closeDirectoryAndTranslateFailure,
  closeFileAndTranslateFailure,
  readAllDirectoryEntries,
  readWholeFileBytes,
} from './knowledge-filesystem-read';
import {
  isLocatorAddressablePath,
  isMarkdownPath,
  joinRelativePath,
  validatePath,
  validateSearchInput,
} from './knowledge-filesystem-validation';
import { resolveKnowledgeBindingDirectory } from './knowledge-filesystem-binding';
import {
  resolveKnowledgeHostPath,
  type KnowledgeHostPathOptions,
} from './knowledge-filesystem-host-path';
import { NODE_FILESYSTEM } from './knowledge-filesystem-node-port';

export * from './knowledge-filesystem-limits';
export {
  KnowledgeFilesystemError,
  type KnowledgeFilesystemErrorCode,
} from './knowledge-filesystem-errors';
export { collectKnowledgePassages } from './knowledge-filesystem-search';

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

/** A searched file's size, whether declared or actually read, must stay
 * within both the fixed per-file cap and the operation's remaining budget. */
function assertWithinSearchByteBudget(
  size: number,
  budget: KnowledgeFilesystemSearchBudget,
): void {
  if (size > KNOWLEDGE_MAX_SEARCH_FILE_BYTES || size > budget.remainingBytes) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
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
  /** Creates one directory, never a chain: a recursive create resolves through
   *  a symbolic link, which is exactly what the walk above refuses. */
  mkdir(directoryPath: string): Promise<void>;
};

export type KnowledgeFilesystemSearchMatch = {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
  readonly excerpt: string;
};

export type KnowledgeFilesystemAdapterPort = Pick<
  KnowledgeFilesystemAdapter,
  'search' | 'resolveHostPath'
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

type DirectoryReadResult = {
  readonly entries: Array<KnowledgeFilesystemDirent>;
  readonly count: number;
};

/** State threaded through one `search()` directory walk: the mutable spend
 * budget and result accumulator, plus the query and options every entry is
 * checked against. */
type KnowledgeSearchWalkContext = {
  readonly query: string;
  readonly budget: KnowledgeFilesystemSearchBudget;
  readonly matches: Array<KnowledgeFilesystemSearchMatch>;
  readonly maxResults: number;
  readonly after: KnowledgeFilesystemSearchAfter | undefined;
  readonly signal: AbortSignal | undefined;
};

/** What one directory entry contributes to the walk: a subdirectory to
 * enqueue, or nothing further (rejected, skipped, or already searched). */
type KnowledgeSearchEntryOutcome =
  | { kind: 'descend'; item: { absolutePath: string; relativePath: string } }
  | { kind: 'none' };

/** Used by `readFile`: the already-open file must be a regular, non-symlink
 *  file within its own caller's byte budget. */
function assertReadableFileStats(
  fileStats: KnowledgeFilesystemStats,
  maxBytes: number,
): void {
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new KnowledgeFilesystemError('knowledge_path_invalid');
  }
  if (fileStats.size > maxBytes) {
    throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
  }
}

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
  ): Promise<Array<KnowledgeFilesystemSearchMatch>> {
    validateSearchInput(query, limit);
    const directory = await this.resolveBindingDirectory(options.signal);
    const ctx: KnowledgeSearchWalkContext = {
      query,
      budget: options.budget ?? createKnowledgeFilesystemSearchBudget(),
      matches: [],
      maxResults: options.maxResults ?? limit,
      after: options.after,
      signal: options.signal,
    };
    const pending = [{ absolutePath: directory, relativePath: '' }];

    while (pending.length > 0) {
      throwIfAborted(ctx.signal);
      const current = pending.pop()!;
      const directoryResult = await this.readDirectory(
        current.absolutePath,
        ctx.budget.remainingEntries,
        ctx.signal,
      );
      ctx.budget.remainingEntries -= directoryResult.count;
      const entries = directoryResult.entries;
      entries.sort((left, right) => compareNames(left.name, right.name));

      for (const entry of entries) {
        throwIfAborted(ctx.signal);
        const outcome = await this.processSearchEntry(
          entry,
          current,
          directory,
          ctx,
        );
        if (outcome.kind === 'descend') pending.push(outcome.item);
      }
    }

    return ctx.matches.sort(compareSearchMatches);
  }

  /**
   * Resolve one directory entry during a search walk: a symlink is rejected,
   * a subdirectory is handed back to enqueue, and a markdown file is
   * searched in place (its matches folded into `ctx.matches`).
   */
  private async processSearchEntry(
    entry: KnowledgeFilesystemDirent,
    current: { absolutePath: string; relativePath: string },
    directory: string,
    ctx: KnowledgeSearchWalkContext,
  ): Promise<KnowledgeSearchEntryOutcome> {
    const relativePath = joinRelativePath(current.relativePath, entry.name);
    const components = validatePath(relativePath);
    const absolutePath = path.join(directory, ...components);
    const stats = await this.lstat(
      absolutePath,
      'knowledge_space_unavailable',
      ctx.signal,
    );
    if (stats.isSymbolicLink() || entry.isSymbolicLink()) {
      throw new KnowledgeFilesystemError('knowledge_path_invalid');
    }
    if (stats.isDirectory()) {
      return { kind: 'descend', item: { absolutePath, relativePath } };
    }
    if (
      stats.isFile() &&
      isMarkdownPath(relativePath) &&
      isLocatorAddressablePath(relativePath)
    ) {
      await this.searchMarkdownFile(absolutePath, relativePath, stats, ctx);
    }
    return { kind: 'none' };
  }

  /** Read, budget-check, and search one already-identified markdown file,
   * folding its passages into `ctx.matches` bounded to `ctx.maxResults`. */
  private async searchMarkdownFile(
    absolutePath: string,
    relativePath: string,
    stats: KnowledgeFilesystemStats,
    ctx: KnowledgeSearchWalkContext,
  ): Promise<void> {
    const { budget, query, maxResults, after, signal } = ctx;
    if (budget.remainingFiles <= 0) {
      throw new KnowledgeFilesystemError('knowledge_limit_exceeded');
    }
    budget.remainingFiles -= 1;
    assertWithinSearchByteBudget(stats.size, budget);
    const bytes = await this.readFile(
      absolutePath,
      Math.min(KNOWLEDGE_MAX_SEARCH_FILE_BYTES, budget.remainingBytes),
      signal,
    );
    assertWithinSearchByteBudget(bytes.length, budget);
    budget.remainingBytes -= bytes.length;
    const fileMatches = await collectKnowledgePassages(
      relativePath,
      decodeUtf8(bytes),
      query,
      { signal, after, maxResults },
    );
    for (const match of fileMatches) {
      ctx.matches.push(match);
      ctx.matches.sort(compareSearchMatches);
      if (ctx.matches.length > maxResults) ctx.matches.pop();
    }
  }

  /**
   * Resolve a Knowledge-relative path to its host path for a caller that
   * opens the target itself. Every component is `lstat`ed and a symbolic link
   * anywhere on the way is refused without being followed; `undefined`
   * addresses the Space's own directory. The final component may be a file or
   * a directory, so this is not a read: the caller decides what to do with
   * what it finds, and closes the check-to-open window with `O_NOFOLLOW`.
   */
  async resolveHostPath(
    relativePath: string | undefined,
    options: KnowledgeHostPathOptions = {},
  ): Promise<string> {
    const directory = await this.resolveBindingDirectory(options.signal);
    return resolveKnowledgeHostPath(
      directory,
      relativePath,
      {
        lstat: (filePath) =>
          this.lstat(filePath, 'knowledge_not_found', options.signal),
        mkdir: (directoryPath) => this.mkdir(directoryPath),
      },
      options,
    );
  }

  private resolveBindingDirectory(
    signal: AbortSignal | undefined,
  ): Promise<string> {
    return resolveKnowledgeBindingDirectory(this.binding, {
      lstat: (filePath) =>
        this.lstat(filePath, 'knowledge_space_unavailable', signal),
      realpath: (filePath) => this.realpath(filePath, signal),
    });
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
    let entries: Array<KnowledgeFilesystemDirent> | undefined;
    try {
      directory = await observeResource(
        () => this.fileSystem.opendir(directoryPath),
        signal,
      );
      entries = await readAllDirectoryEntries(
        directory,
        remainingEntries,
        signal,
      );
    } catch (error) {
      failure = error;
    }
    await closeDirectoryAndTranslateFailure(directory, failure, signal);
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
      assertReadableFileStats(fileStats, maxBytes);
      bytes = await readWholeFileBytes(file, maxBytes, signal);
    } catch (error) {
      failure = error;
    }
    await closeFileAndTranslateFailure(file, failure, signal);
    return bytes ?? Buffer.alloc(0);
  }

  private async mkdir(directoryPath: string): Promise<void> {
    try {
      await this.fileSystem.mkdir(directoryPath);
    } catch (error) {
      if (error instanceof KnowledgeFilesystemError) throw error;
      throw new KnowledgeFilesystemError('knowledge_space_unavailable');
    }
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
