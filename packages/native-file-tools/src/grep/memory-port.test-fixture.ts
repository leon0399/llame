import {
  compileGrepPatterns,
  compileGlob,
  GREP_LIMITS,
  GrepPortError,
  runGrepScan,
} from "./index";
import type {
  DecodedGrepCursor,
  GrepBudget,
  GrepEntry,
  GrepFileStream,
  GrepScanResult,
  GrepScope,
  GrepWalkPort,
} from "./index";

/** How a memory file can misbehave, as a real one can. */
type MemoryFileFaults = {
  /** Report this size instead of the content's, as a file that grows does. */
  readonly announcedSize?: number;
  /** Hand the content over in chunks of at most this many bytes. */
  readonly chunkBytes?: number;
  /** Refuse after the last chunk, as a late read failure does. */
  readonly lateRefusal?: "oversized" | "unreadable";
};

/** One node of an in-memory tree a test walks instead of a real filesystem. */
export type MemoryNode =
  | ({
      readonly kind: "file";
      readonly content: string;
      /** Refuse at open, as a port that cannot hand the file over does. */
      readonly refusal?: "oversized" | "unreadable";
    } & MemoryFileFaults)
  | ({ readonly kind: "binary"; readonly bytes: Uint8Array } & MemoryFileFaults)
  | {
      readonly kind: "directory";
      readonly children: MemoryTree;
      readonly identity?: string;
    }
  | { readonly kind: "link"; readonly identity?: string }
  | { readonly kind: "other" };

export interface MemoryTree {
  readonly [name: string]: MemoryNode;
}

/** A port that records what the engine listed and opened. */
export interface MemoryPort extends GrepWalkPort {
  readonly lists: Array<string>;
  readonly reads: Array<string>;
  /** Files whose stream was closed, in order, the ones never started too. */
  readonly closes: Array<string>;
}

function resolveMemoryNode(
  tree: MemoryTree,
  rel: string,
): MemoryNode | undefined {
  let node: MemoryNode | undefined = { kind: "directory", children: tree };
  if (rel.length === 0) return node;
  for (const segment of rel.split("/")) {
    if (node === undefined || node.kind !== "directory") return undefined;
    node = node.children[segment];
  }
  return node;
}

function openMemoryNode(
  node: MemoryNode | undefined,
  close: () => Promise<void>,
): GrepFileStream | { readonly kind: "oversized" | "unreadable" } {
  if (node === undefined || (node.kind !== "file" && node.kind !== "binary"))
    return { kind: "unreadable" };
  if (node.kind === "file" && node.refusal !== undefined)
    return { kind: node.refusal };
  const bytes =
    node.kind === "file" ? Buffer.from(node.content, "utf8") : node.bytes;
  const chunks: Array<
    Uint8Array | { readonly kind: "oversized" | "unreadable" }
  > = chunkBytes(bytes, node.chunkBytes ?? bytes.byteLength);
  if (node.lateRefusal !== undefined) chunks.push({ kind: node.lateRefusal });
  return {
    size: node.announcedSize ?? bytes.byteLength,
    close,
    chunks: chunkSequence(chunks),
  };
}

/** One byte array in chunks of at most `width`, the last one short. */
export function chunkBytes(
  bytes: Uint8Array,
  width: number,
): Array<Uint8Array> {
  const chunks: Array<Uint8Array> = [];
  for (let offset = 0; offset < bytes.byteLength; offset += width)
    chunks.push(bytes.subarray(offset, offset + width));
  return chunks;
}

/** One list handed over as the async chunk sequence a port streams. */
export function chunkSequence<T>(items: ReadonlyArray<T>): AsyncIterable<T> {
  let index = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = items[index];
        index += 1;
        return value === undefined
          ? Promise.resolve({ done: true, value: undefined })
          : Promise.resolve({ done: false, value });
      },
    }),
  };
}

function entryFor(name: string, child: MemoryNode): GrepEntry {
  if (child.kind === "binary") return { name, kind: "file" };
  if (child.kind === "directory")
    return { name, kind: "directory", identity: child.identity };
  return { name, kind: child.kind };
}

/** Host-style port; a `.gitignore` child is the directory's ignore file. */
export function createMemoryPort(
  tree: MemoryTree,
  followsLinks = false,
): MemoryPort {
  const lists: Array<string> = [];
  const reads: Array<string> = [];
  const closes: Array<string> = [];
  return {
    followsLinks,
    lists,
    reads,
    closes,
    list(rel: string): Promise<ReadonlyArray<GrepEntry>> {
      lists.push(rel);
      const node = resolveMemoryNode(tree, rel);
      if (node === undefined || node.kind !== "directory")
        return Promise.reject(new GrepPortError(`not a directory: ${rel}`));
      return Promise.resolve(
        Object.entries(node.children).map(([name, child]) =>
          entryFor(name, child),
        ),
      );
    },
    open(rel: string) {
      reads.push(rel);
      const close = (): Promise<void> => {
        closes.push(rel);
        return Promise.resolve();
      };
      return Promise.resolve(
        openMemoryNode(resolveMemoryNode(tree, rel), close),
      );
    },
    ignoreFile(rel: string): Promise<string | undefined> {
      const node = resolveMemoryNode(tree, rel);
      if (node === undefined || node.kind !== "directory")
        return Promise.resolve(undefined);
      const ignored = node.children[".gitignore"];
      return Promise.resolve(
        ignored !== undefined && ignored.kind === "file"
          ? ignored.content
          : undefined,
      );
    },
  };
}

/**
 * A port for a single-file scope: `open('')` hands over the named file and
 * nothing is ever listed. `ignoreText` stands in for a `.gitignore` the
 * engine must not consult for an exact path.
 */
export function createSingleFilePort(
  node: MemoryNode,
  ignoreText?: string,
): MemoryPort {
  const reads: Array<string> = [];
  const closes: Array<string> = [];
  return {
    followsLinks: false,
    lists: [],
    reads,
    closes,
    list(rel: string): Promise<ReadonlyArray<GrepEntry>> {
      return Promise.reject(new GrepPortError(`not a directory: ${rel}`));
    },
    open(rel: string) {
      reads.push(rel);
      const close = (): Promise<void> => {
        closes.push(rel);
        return Promise.resolve();
      };
      return Promise.resolve(
        openMemoryNode(rel.length === 0 ? node : undefined, close),
      );
    },
    ignoreFile(rel: string): Promise<string | undefined> {
      return Promise.resolve(rel.length === 0 ? ignoreText : undefined);
    },
  };
}

export interface MemoryScopeOptions {
  readonly glob?: string;
  readonly singleFile?: boolean;
  readonly locatorFor?: (rel: string) => string;
}

/** A scope whose locator is the prefix plus the relative path. */
export function memoryScope(
  index: number,
  prefix: string,
  port: GrepWalkPort,
  options: MemoryScopeOptions = {},
): GrepScope {
  return {
    index,
    locatorPrefix: prefix,
    port,
    glob: options.glob === undefined ? undefined : compileGlob(options.glob),
    singleFile: options.singleFile ?? false,
    locatorFor: options.locatorFor ?? ((rel) => `${prefix}${rel}`),
  };
}

export interface MemoryScanOptions {
  readonly literal?: boolean;
  readonly ignoreCase?: boolean;
  readonly budget?: Partial<GrepBudget>;
  readonly cursor?: DecodedGrepCursor;
  readonly inputHash?: string;
  readonly onCandidate?: (locator: string) => Promise<boolean>;
  readonly now?: () => number;
}

export function memoryBudget(overrides: Partial<GrepBudget> = {}): GrepBudget {
  return {
    files: GREP_LIMITS.filesExamined,
    entries: GREP_LIMITS.entriesListed,
    bytes: GREP_LIMITS.bytesRead,
    maxFileBytes: null,
    deadlineMs: GREP_LIMITS.deadlineMs,
    limit: GREP_LIMITS.filesPerPage,
    pageUnits: GREP_LIMITS.pageCodeUnits,
    fixedReserve: 0,
    ...overrides,
  };
}

/** Run one scan against memory scopes with the shared defaults. */
export function runMemoryScan(
  scopes: ReadonlyArray<GrepScope>,
  patterns: ReadonlyArray<string>,
  options: MemoryScanOptions = {},
): Promise<GrepScanResult> {
  const compiled = compileGrepPatterns({
    patterns,
    literal: options.literal ?? false,
    ignoreCase: options.ignoreCase ?? false,
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return runGrepScan({
    scopes,
    patterns: compiled.compiled,
    onCandidate: options.onCandidate ?? (() => Promise.resolve(true)),
    budget: memoryBudget(options.budget),
    cursor: options.cursor,
    inputHash: options.inputHash ?? "input-hash",
    now: options.now ?? (() => 0),
  });
}
