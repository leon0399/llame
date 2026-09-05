import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { isRecord, isString } from '@workspace/runtime-safety';

export const KNOWLEDGE_SPACE_UNAVAILABLE = 'knowledge_space_unavailable';

/** Safe domain error; never carries a configured host path or raw fs error. */
export class KnowledgeSpaceUnavailableError extends Error {
  readonly code = KNOWLEDGE_SPACE_UNAVAILABLE;

  constructor() {
    super('Knowledge Space is unavailable.');
    this.name = 'KnowledgeSpaceUnavailableError';
  }
}

type KnowledgeFileStats = {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

export type KnowledgeFileSystem = {
  lstatSync(filePath: string): KnowledgeFileStats;
  mkdirSync(directoryPath: string): void;
  realpathSync(filePath: string): string;
};

const NODE_FILE_SYSTEM: KnowledgeFileSystem = {
  lstatSync: (filePath) => lstatSync(filePath),
  mkdirSync: (directoryPath) => mkdirSync(directoryPath),
  realpathSync: (filePath) => realpathSync(filePath),
};

const TRUSTED_SPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Resolves only the operator-configured root and the server-derived child.
 * It accepts no caller path and never searches for alternate directories.
 */
export class KnowledgeSpaceLocalResolver {
  constructor(
    private readonly configuredRoot: string | undefined,
    private readonly fileSystem: KnowledgeFileSystem = NODE_FILE_SYSTEM,
  ) {}

  resolveRoot(): string {
    if (this.configuredRoot === undefined) {
      throw new KnowledgeSpaceUnavailableError();
    }

    try {
      const canonicalRoot = this.fileSystem.realpathSync(this.configuredRoot);
      const stats = this.fileSystem.lstatSync(canonicalRoot);
      if (!stats.isDirectory()) {
        throw new KnowledgeSpaceUnavailableError();
      }
      return canonicalRoot;
    } catch (error) {
      if (error instanceof KnowledgeSpaceUnavailableError) throw error;
      throw new KnowledgeSpaceUnavailableError();
    }
  }

  ensureChild(canonicalRoot: string, knowledgeSpaceId: string): string {
    const childPath = this.deriveChildPath(canonicalRoot, knowledgeSpaceId);

    let stats: KnowledgeFileStats;
    try {
      stats = this.fileSystem.lstatSync(childPath);
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw new KnowledgeSpaceUnavailableError();
      }
      try {
        this.fileSystem.mkdirSync(childPath);
        stats = this.fileSystem.lstatSync(childPath);
      } catch (error) {
        if (!isFileAlreadyExists(error)) {
          throw new KnowledgeSpaceUnavailableError();
        }
        try {
          stats = this.fileSystem.lstatSync(childPath);
        } catch {
          throw new KnowledgeSpaceUnavailableError();
        }
      }
    }

    this.validateExistingChild(childPath, stats);
    return childPath;
  }

  resolveChild(canonicalRoot: string, knowledgeSpaceId: string): string {
    const childPath = this.deriveChildPath(canonicalRoot, knowledgeSpaceId);
    let stats: KnowledgeFileStats;
    try {
      stats = this.fileSystem.lstatSync(childPath);
    } catch {
      throw new KnowledgeSpaceUnavailableError();
    }

    this.validateExistingChild(childPath, stats);
    return childPath;
  }

  private deriveChildPath(
    canonicalRoot: string,
    knowledgeSpaceId: string,
  ): string {
    if (!TRUSTED_SPACE_ID_PATTERN.test(knowledgeSpaceId)) {
      throw new KnowledgeSpaceUnavailableError();
    }

    const childPath = path.join(canonicalRoot, knowledgeSpaceId);
    if (
      path.dirname(childPath) !== canonicalRoot ||
      path.basename(childPath) !== knowledgeSpaceId
    ) {
      throw new KnowledgeSpaceUnavailableError();
    }
    return childPath;
  }

  private validateExistingChild(
    childPath: string,
    stats: KnowledgeFileStats,
  ): void {
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new KnowledgeSpaceUnavailableError();
    }

    try {
      const canonicalChild = this.fileSystem.realpathSync(childPath);
      if (canonicalChild !== childPath) {
        throw new KnowledgeSpaceUnavailableError();
      }
    } catch (error) {
      if (error instanceof KnowledgeSpaceUnavailableError) throw error;
      throw new KnowledgeSpaceUnavailableError();
    }
  }
}

export type KnowledgeSpaceLocalResolverPort = Pick<
  KnowledgeSpaceLocalResolver,
  'resolveRoot' | 'ensureChild' | 'resolveChild'
>;

function isFileNotFound(error: unknown): boolean {
  return (
    isRecord(error) && isString(error['code']) && error['code'] === 'ENOENT'
  );
}

function isFileAlreadyExists(error: unknown): boolean {
  return (
    isRecord(error) && isString(error['code']) && error['code'] === 'EEXIST'
  );
}
