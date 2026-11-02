import {
  compileGrepPatterns,
  compileGlob,
  GREP_IGNORE_FILE_NAMES,
  GREP_LIMITS,
  GrepPortError,
  runGrepScan,
} from "./index";
import type {
  DecodedGrepCursor,
  GrepBudget,
  GrepEntry,
  GrepFileStream,
  GrepIgnoreFile,
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
    // A real stream closes its handle when its last byte arrives; the record
    // then proves which files the walk opened and released.
    chunks: closeWhenDone(chunkSequence(chunks), close),
  };
}

/** One stream that releases its file once its bytes are done. */
async function* closeWhenDone<T>(
  items: AsyncIterable<T>,
  close: () => Promise<void>,
): AsyncGenerator<T> {
  try {
    yield* items;
  } finally {
    await close();
  }
}

/** One byte array in chunks of at most `width`, the last one short. */
export function chunkBytes(
  bytes: Uint8Array,
  width: number,
): Array<Uint8Array> {
  if (!Number.isInteger(width) || width <= 0)
    throw new RangeError("a chunk width must be a positive integer");
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

/** The ignore text a memory directory holds under one file name. */
function memoryIgnoreText(
  node: MemoryNode | undefined,
  name: string,
): string | undefined {
  if (node === undefined || node.kind !== "directory") return undefined;
  const file = node.children[name];
  return file !== undefined && file.kind === "file" ? file.content : undefined;
}

/**
 * Host-style port; a `.gitignore` and a `.ignore` child are the directory's
 * ignore files, and `ancestors` stands in for the files above the prefix.
 */
export function createMemoryPort(
  tree: MemoryTree,
  followsLinks = false,
  ancestors: ReadonlyArray<GrepIgnoreFile> = [],
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
      // One release per opened stream: a cancel closes it, and the stream's
      // own end closes it again.
      let released = false;
      const close = (): Promise<void> => {
        if (released) return Promise.resolve();
        released = true;
        closes.push(rel);
        return Promise.resolve();
      };
      return Promise.resolve(
        openMemoryNode(resolveMemoryNode(tree, rel), close),
      );
    },
    ignoreFiles(rel: string): Promise<ReadonlyArray<string>> {
      const node = resolveMemoryNode(tree, rel);
      const texts: Array<string> = [];
      for (const name of GREP_IGNORE_FILE_NAMES) {
        const text = memoryIgnoreText(node, name);
        if (text !== undefined) texts.push(text);
      }
      return Promise.resolve(texts);
    },
    ignoreAncestors: () => Promise.resolve(ancestors),
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
      let released = false;
      const close = (): Promise<void> => {
        if (released) return Promise.resolve();
        released = true;
        closes.push(rel);
        return Promise.resolve();
      };
      return Promise.resolve(
        openMemoryNode(rel.length === 0 ? node : undefined, close),
      );
    },
    ignoreFiles(rel: string): Promise<ReadonlyArray<string>> {
      return Promise.resolve(
        rel.length === 0 && ignoreText !== undefined ? [ignoreText] : [],
      );
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
  /** The call already progressed in an earlier segment. */
  readonly progressed?: boolean;
  readonly ignoreCase?: boolean;
  readonly budget?: Partial<GrepBudget>;
  readonly cursor?: DecodedGrepCursor;
  readonly inputHash?: string;
  readonly onCandidate?: (locator: string) => Promise<boolean>;
  readonly now?: () => number;
}

/** The walk's own defaults: no count or size bound, and a generous deadline. */
export function memoryBudget(overrides: Partial<GrepBudget> = {}): GrepBudget {
  return {
    files: null,
    entries: null,
    bytes: null,
    maxFileBytes: null,
    deadlineMs: 30_000,
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
    progressed: options.progressed,
    inputHash: options.inputHash ?? "input-hash",
    now: options.now ?? (() => 0),
  });
}
