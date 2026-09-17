import { lstatSync, opendirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { type UnknownRecord } from '@workspace/runtime-safety';
import {
  parseSkillPackage,
  readFrontmatterInvocationControl,
  readSidecarInvocationControl,
  type InvocationControlValue,
} from './skill-package';

/** Fixed bound on configured sources (system-provided-skills D1). */
export const MAX_SKILL_SOURCES = 32;
/** Fixed bound on immediate children read from one source. */
export const MAX_SOURCE_CHILDREN = 10_000;

const SKILL_DOCUMENT_FILENAME = 'SKILL.md';
const LLAME_SIDECAR_PATH = path.join('agents', 'llame.yaml');
const OPENAI_SIDECAR_PATH = path.join('agents', 'openai.yaml');

/** One immediate source child, as the discovery scan needs it. */
export type CatalogDirent = {
  readonly name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

/** What a path is, from the catalog's point of view. */
export type CatalogFileKind = 'file' | 'directory' | 'missing' | 'unavailable';

/**
 * Filesystem seam for discovery. Production always uses the real implementation;
 * tests supply one to simulate a source that cannot be read without depending
 * on process permissions.
 */
export type SkillCatalogFileSystem = {
  readDirectory(directoryPath: string): ReadonlyArray<CatalogDirent>;
  readTextFile(filePath: string): string;
  fileKind(filePath: string): CatalogFileKind;
};

/**
 * The production filesystem seam. Exported so a test can delegate to it and
 * override only the operation it needs to fail.
 */
export const NODE_SKILL_FILE_SYSTEM: SkillCatalogFileSystem = {
  readDirectory: (directoryPath) => {
    const dir = opendirSync(directoryPath);
    const entries: Array<CatalogDirent> = [];
    try {
      let dirent = dir.readSync();
      while (dirent !== null) {
        entries.push(dirent);
        if (entries.length > MAX_SOURCE_CHILDREN) break;
        dirent = dir.readSync();
      }
    } finally {
      dir.closeSync();
    }
    return entries;
  },
  readTextFile: (filePath) => readFileSync(filePath, 'utf8'),
  fileKind: (filePath) => {
    try {
      const link = lstatSync(filePath);
      if (link.isSymbolicLink()) return followedKind(filePath);
      if (link.isFile()) return 'file';
      return link.isDirectory() ? 'directory' : 'unavailable';
    } catch (error) {
      return isNotFound(error) ? 'missing' : 'unavailable';
    }
  },
};

export type SkillCatalogEntry = {
  readonly name: string;
  readonly description: string | null;
  /** Whether the package may be selected proactively rather than explicitly. */
  readonly proactive: boolean;
  /** The configured source this package was selected from. */
  readonly sourceDirectory: string | null;
  /** The package directory as discovered beneath its configured source; null
   *  when it could not be resolved. A symbolic-link child is published at its
   *  link path, not at the directory the link points to. */
  readonly skillDirectory: string | null;
  readonly available: boolean;
  readonly diagnostics: ReadonlyArray<string>;
};

/**
 * One catalog read. `available: false` means discovery itself could not run to
 * completion (an unreadable or oversized source), so `entries` is empty rather
 * than a partial map whose precedence cannot be trusted.
 */
export type SkillCatalogSnapshot = {
  readonly available: boolean;
  readonly directories: ReadonlyArray<string>;
  readonly entries: ReadonlyArray<SkillCatalogEntry>;
  readonly diagnostics: ReadonlyArray<string>;
};

/** The read surface every consumer depends on, narrower than the class. */
export type SkillCatalogPort = Pick<SkillCatalog, 'getSnapshot'>;

/**
 * The one in-process catalog port (design D1). Every later skill layer reads
 * the catalog through this, so precedence and invocation control are resolved
 * in exactly one place. Discovery is live: nothing is cached, so editing a
 * package inside an already configured source takes effect on the next read
 * without a restart.
 */
export class SkillCatalog {
  private readonly directories: ReadonlyArray<string>;
  private readonly fileSystem: SkillCatalogFileSystem;

  constructor(
    directories: ReadonlyArray<string>,
    fileSystem: SkillCatalogFileSystem = NODE_SKILL_FILE_SYSTEM,
  ) {
    this.directories = [...directories];
    this.fileSystem = fileSystem;
  }

  getSnapshot(): SkillCatalogSnapshot {
    const directories = this.directories;
    if (directories.length > MAX_SKILL_SOURCES) {
      return this.unavailable(
        directories,
        `At most ${MAX_SKILL_SOURCES} skill sources are supported; the catalog is unavailable.`,
      );
    }
    if (directories.length === 0) {
      return { available: true, directories, entries: [], diagnostics: [] };
    }

    const winners = new Map<string, SkillCatalogEntry>();
    for (const directory of directories) {
      const result = this.readSource(directory);
      if (result.status === 'unavailable') {
        return this.unavailable(directories, result.diagnostic);
      }
      for (const entry of result.entries) winners.set(entry.name, entry);
    }

    return {
      available: true,
      directories,
      entries: [...winners.values()].sort((left, right) =>
        compareSkillNames(left.name, right.name),
      ),
      diagnostics: [],
    };
  }

  private readSource(sourceDirectory: string):
    | {
        readonly status: 'read';
        readonly entries: ReadonlyArray<SkillCatalogEntry>;
      }
    | { readonly status: 'unavailable'; readonly diagnostic: string } {
    let children: ReadonlyArray<CatalogDirent>;
    try {
      children = this.fileSystem.readDirectory(sourceDirectory);
    } catch {
      return {
        status: 'unavailable',
        diagnostic: `Skill source ${sourceDirectory} is missing or unreadable; the catalog is unavailable.`,
      };
    }
    if (children.length > MAX_SOURCE_CHILDREN) {
      return {
        status: 'unavailable',
        diagnostic: `Skill source ${sourceDirectory} exceeds ${MAX_SOURCE_CHILDREN} children; the catalog is unavailable.`,
      };
    }

    const entries: Array<SkillCatalogEntry> = [];
    for (const child of children) {
      const entry = this.readChild(child, sourceDirectory);
      if (entry !== undefined) entries.push(entry);
    }
    return { status: 'read', entries };
  }

  /** A child that is not a package at all (no `SKILL.md`, or a plain child
   *  that is not a directory) yields `undefined`; anything package-shaped
   *  yields an entry, available or not. */
  private readChild(
    child: CatalogDirent,
    sourceDirectory: string,
  ): SkillCatalogEntry | undefined {
    const resolved = this.resolvePackageDirectory(child, sourceDirectory);
    if (resolved.status === 'not-a-package') return undefined;
    if (resolved.status === 'unavailable') {
      return this.unavailableEntry(
        child.name,
        sourceDirectory,
        resolved.directory,
        resolved.diagnostic,
      );
    }

    const document = this.readSkillDocument(
      path.join(resolved.directory, SKILL_DOCUMENT_FILENAME),
    );
    if (document.status === 'missing') return undefined;
    if (document.status === 'unavailable') {
      return this.unavailableEntry(
        child.name,
        sourceDirectory,
        resolved.directory,
        document.diagnostic,
      );
    }

    return this.entryFor(
      child.name,
      sourceDirectory,
      resolved.directory,
      document.text,
    );
  }

  /** Validate one readable `SKILL.md` into an entry. An invalid package is an
   *  unavailable entry, never a partial success. */
  private entryFor(
    name: string,
    sourceDirectory: string,
    packageDirectory: string,
    text: string,
  ): SkillCatalogEntry {
    const parsed = parseSkillPackage(text, name);
    if (parsed.status === 'invalid') {
      return this.unavailableEntry(
        name,
        sourceDirectory,
        packageDirectory,
        parsed.diagnostic,
      );
    }

    const proactive = this.resolveProactive(
      packageDirectory,
      parsed.frontmatter,
    );
    if (proactive === 'invalid') {
      return this.unavailableEntry(
        name,
        sourceDirectory,
        packageDirectory,
        'The consulted invocation control is malformed.',
      );
    }

    return {
      name: parsed.name,
      description: parsed.description,
      proactive,
      sourceDirectory,
      skillDirectory: packageDirectory,
      available: true,
      diagnostics: [],
    };
  }

  /** A child is a package when it resolves to a directory; the `SKILL.md`
   *  check that follows decides whether it is discoverable at all. A symbolic
   *  link that does not resolve to a directory is an unavailable entry naming
   *  the link or the kind of its target. */
  private resolvePackageDirectory(
    child: CatalogDirent,
    sourceDirectory: string,
  ): PackageDirectoryResolution {
    const childPath = path.join(sourceDirectory, child.name);
    if (!child.isSymbolicLink()) {
      return child.isDirectory()
        ? { status: 'package', directory: childPath }
        : { status: 'not-a-package' };
    }

    const kind = this.fileSystem.fileKind(childPath);
    if (kind === 'directory') {
      return { status: 'package', directory: childPath };
    }
    if (kind === 'file') {
      return {
        status: 'unavailable',
        directory: childPath,
        diagnostic: `The package symlink ${childPath} resolves to a regular file, not a directory.`,
      };
    }
    return {
      status: 'unavailable',
      directory: childPath,
      diagnostic: `The package symlink ${childPath} could not be resolved.`,
    };
  }

  private readSkillDocument(documentPath: string): SkillDocumentRead {
    const kind = this.fileSystem.fileKind(documentPath);
    if (kind === 'missing') return { status: 'missing' };
    if (kind !== 'file') {
      return {
        status: 'unavailable',
        diagnostic: `${SKILL_DOCUMENT_FILENAME} is not a readable regular file.`,
      };
    }
    try {
      return { status: 'ok', text: this.fileSystem.readTextFile(documentPath) };
    } catch {
      return {
        status: 'unavailable',
        diagnostic: `${SKILL_DOCUMENT_FILENAME} could not be read.`,
      };
    }
  }

  /**
   * Resolve proactive invocability in precedence order, reading a lower sidecar
   * only when every higher control fell through — so an ignored fallback is
   * never parsed and cannot invalidate the package.
   */
  private resolveProactive(
    packageDirectory: string,
    frontmatter: UnknownRecord,
  ): boolean | 'invalid' {
    const llame = this.readSidecarControl(
      path.join(packageDirectory, LLAME_SIDECAR_PATH),
    );
    if (llame !== 'absent') return llame;

    const declared = readFrontmatterInvocationControl(frontmatter);
    if (declared !== 'absent') return declared;

    const openai = this.readSidecarControl(
      path.join(packageDirectory, OPENAI_SIDECAR_PATH),
    );
    return openai === 'absent' ? true : openai;
  }

  private readSidecarControl(filePath: string): InvocationControlValue {
    const kind = this.fileSystem.fileKind(filePath);
    if (kind === 'missing') return 'absent';
    if (kind !== 'file') return 'invalid';
    try {
      return readSidecarInvocationControl(
        this.fileSystem.readTextFile(filePath),
      );
    } catch {
      return 'invalid';
    }
  }

  private unavailable(
    directories: ReadonlyArray<string>,
    diagnostic: string,
  ): SkillCatalogSnapshot {
    return {
      available: false,
      directories,
      entries: [],
      diagnostics: [diagnostic],
    };
  }

  private unavailableEntry(
    name: string,
    sourceDirectory: string,
    skillDirectory: string,
    diagnostic: string,
  ): SkillCatalogEntry {
    return {
      name,
      description: null,
      proactive: false,
      sourceDirectory,
      skillDirectory,
      available: false,
      diagnostics: [diagnostic],
    };
  }
}

type PackageDirectoryResolution =
  | { readonly status: 'package'; readonly directory: string }
  | { readonly status: 'not-a-package' }
  | {
      readonly status: 'unavailable';
      readonly directory: string;
      readonly diagnostic: string;
    };

type SkillDocumentRead =
  | { readonly status: 'ok'; readonly text: string }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable'; readonly diagnostic: string };

/**
 * Code-point order for catalog names, so a non-ASCII directory name sorts
 * deterministically rather than by UTF-16 surrogate code unit. The catalog
 * lists entries with this and callers page with it.
 */
export function compareSkillNames(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/**
 * The kind of a symbolic link's target, following the link as the operating
 * system does. A link that cannot be followed is `unavailable` rather than
 * `missing`, so a dangling link stays an inspectable entry with a diagnostic.
 */
function followedKind(filePath: string): CatalogFileKind {
  try {
    const target = statSync(filePath);
    if (target.isDirectory()) return 'directory';
    return target.isFile() ? 'file' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
