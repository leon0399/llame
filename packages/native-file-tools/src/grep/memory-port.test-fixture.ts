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
  GrepScanResult,
  GrepScope,
  GrepWalkPort,
} from "./index";

/** One node of an in-memory tree a test walks instead of a real filesystem. */
export type MemoryNode =
  | {
      readonly kind: "file";
      readonly content: string;
      readonly refusal?: "oversized" | "unreadable";
    }
  | { readonly kind: "binary"; readonly bytes: Uint8Array }
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

function readMemoryNode(
  node: MemoryNode | undefined,
  maxBytes: number,
): Uint8Array | { readonly kind: "oversized" | "unreadable" } {
  if (node === undefined || (node.kind !== "file" && node.kind !== "binary"))
    return { kind: "unreadable" };
  if (node.kind === "file" && node.refusal !== undefined)
    return { kind: node.refusal };
  const bytes =
    node.kind === "file" ? Buffer.from(node.content, "utf8") : node.bytes;
  if (bytes.byteLength > maxBytes) return { kind: "oversized" };
  return bytes;
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
  return {
    followsLinks,
    lists,
    reads,
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
    read(rel: string, maxBytes: number) {
      reads.push(rel);
      return Promise.resolve(
        readMemoryNode(resolveMemoryNode(tree, rel), maxBytes),
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
 * A port for a single-file scope: `read('')` hands over the named file and
 * nothing is ever listed. `ignoreText` stands in for a `.gitignore` the
 * engine must not consult for an exact path.
 */
export function createSingleFilePort(
  node: MemoryNode,
  ignoreText?: string,
): MemoryPort {
  const reads: Array<string> = [];
  return {
    followsLinks: false,
    lists: [],
    reads,
    list(rel: string): Promise<ReadonlyArray<GrepEntry>> {
      return Promise.reject(new GrepPortError(`not a directory: ${rel}`));
    },
    read(rel: string, maxBytes: number) {
      reads.push(rel);
      return Promise.resolve(readMemoryNode(node, maxBytes));
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
