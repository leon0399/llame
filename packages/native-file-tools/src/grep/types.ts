import type { DecodedGrepCursor } from "./cursor";
import type { CompiledGrepPatterns } from "./patterns";
import type { CompiledGlob } from "./scope";

/** One directory entry as a walk port reports it. */
export interface GrepEntry {
  /** One path segment, no separator. */
  readonly name: string;
  readonly kind: "file" | "directory" | "link" | "other";
  /** Optional canonical id for loop detection (skill port only). */
  readonly identity?: string;
}

/**
 * What a port's `read` returns when it refuses to hand over content. The
 * walk counts `oversized` and `unreadable` skips.
 */
export type GrepReadRefusal = {
  readonly kind: "oversized" | "unreadable";
};

/** The abstract directory tree one scope walks. */
export interface GrepWalkPort {
  /** List one directory. `rel` is ''-rooted, '/'-separated, relative to the scope prefix. Throws GrepPortError on failure. */
  list(rel: string): Promise<ReadonlyArray<GrepEntry>>;
  /** Read up to `maxBytes + 1` bytes. Returns a refusal when the file exceeds maxBytes or cannot be opened. */
  read(rel: string, maxBytes: number): Promise<Uint8Array | GrepReadRefusal>;
  /** Ignore-file text for a directory, when this scheme honors .gitignore (host, machine). Absent on kb/skill ports. */
  ignoreFile?(rel: string): Promise<string | undefined>;
  /** True when this port's links are pre-resolved (skill). The engine never follows a `link` entry. */
  readonly followsLinks: boolean;
}

/** A failure a port raises while listing; the call fails as a whole. */
export class GrepPortError extends Error {}

/** One admitted scope plus the walk port that serves it. */
export interface GrepScope {
  /** Submitted scope index, the primary result order. */
  readonly index: number;
  /** Canonical locator of the prefix, e.g. 'kb://<id>/notes/' or '/home/u/repo/' (ends with '/' for a directory). */
  readonly locatorPrefix: string;
  readonly port: GrepWalkPort;
  /** Undefined => recursive directory or single file. */
  readonly glob: CompiledGlob | undefined;
  /** The prefix names one regular file (no walk). */
  readonly singleFile: boolean;
  /** Format a rel path into the canonical locator of the scheme. */
  readonly locatorFor: (rel: string) => string;
}

/** Remaining budget of one call. */
export interface GrepBudget {
  files: number;
  entries: number;
  bytes: number;
  deadlineMs: number;
  limit: number;
  pageUnits: number;
  /**
   * Units the caller's own result fields take beside the passages: the status
   * and completeness envelope, its warnings, and its notice. A page keeps them
   * back before it admits a passage, so it never needs a second walk.
   */
  fixedReserve: number;
}

export interface GrepPassage {
  locator: string;
  content: string;
  matches: ReadonlyArray<number>;
  truncated?: true;
}

/** Every kind of skip or bound a walk can report, so a caller may size them. */
export const GREP_WARNING_KINDS = [
  "binary",
  "invalid_utf8",
  "oversized",
  "unreadable",
  "link",
  "file_bound",
  "entry_bound",
  "byte_bound",
  "deadline",
] as const;

export type GrepWarningKind = (typeof GREP_WARNING_KINDS)[number];

export interface GrepWarning {
  kind: GrepWarningKind;
  count: number;
}

export interface GrepScanResult {
  results: Array<GrepPassage>;
  complete: boolean;
  cursor?: string;
  warnings: Array<GrepWarning>;
  /** For the audit only; the caller must not put it in the model result. */
  readRefused: number;
  consumed: { files: number; entries: number; bytes: number };
}

export interface GrepScanInput {
  scopes: ReadonlyArray<GrepScope>;
  patterns: CompiledGrepPatterns;
  /** Per-candidate read-group check. false => file is listed, not opened, counted in readRefused. */
  onCandidate: (locator: string) => Promise<boolean>;
  /** Remaining budget; defaults come from GREP_LIMITS. */
  budget: GrepBudget;
  /** Already validated against inputHash by the caller. */
  cursor?: DecodedGrepCursor;
  /** Hex sha256 over resolved inputs, computed by the caller (see cursor.ts helper). */
  inputHash: string;
  now: () => number;
}
