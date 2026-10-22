/**
 * `fs.grep`: the grep walk runs here, on the Machine, under the same shared
 * engine the hub uses. The request names the literal prefix, the glob suffix,
 * the patterns, the remaining budget, and a resume key; the answer names every
 * passage relative to that prefix, so a host path never travels to the hub.
 * The prefix is resolved through the registered roots before any listing, and
 * a refusal is a result or the protocol's own `path_not_registered`, exactly
 * as `read` refuses.
 */

import {
  FS_GREP_METHOD,
  fsGrepCursorKey,
  type FsGrepPassage,
  type FsGrepResult,
  type NativeFailureResult,
  type SerializableRecord,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  compileGlob,
  compileGrepPatterns,
  decodeGrepCursor,
  GREP_LIMITS,
  runGrepScan,
  type GrepBudget,
  type GrepPassage,
  type GrepScanResult,
  type GrepScope,
} from "@workspace/native-file-tools";

import type { OperationContext } from "./dispatch-types";
import { invalidParams } from "./errors";
import { createGrepWalkPort, GrepWalkFailure } from "./grep-port";
import {
  optionalString,
  paramRecord,
  requireBoolean,
  requireCount,
  requireRecord,
  requireString,
  requireStringList,
} from "./params";

const NOT_FOUND_MESSAGE = "The target does not exist.";
const NOT_REGULAR_FILE = "The target is not a regular file.";

/** The one scope a request searches; the daemon cursor names it as index 0. */
const SCOPE_INDEX = 0;

function failure(
  type: NativeFailureResult["type"],
  message: string,
): NativeFailureResult {
  return { status: "error", type, message };
}

/** One validated request, read once from untrusted parameters. */
type GrepRequest = {
  readonly path: string;
  readonly globSuffix: string | undefined;
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
  readonly cursor: string | undefined;
  readonly budget: GrepBudget;
};

function readBudget(source: SerializableRecord): GrepBudget {
  const budget = requireRecord(source, "budget", FS_GREP_METHOD);
  return {
    // The wire budget is the page the hub has left for passages; the fields
    // beside the daemon's own result travel on the hub, never here.
    files: requireCount(budget, "files", FS_GREP_METHOD),
    entries: requireCount(budget, "entries", FS_GREP_METHOD),
    bytes: requireCount(budget, "bytes", FS_GREP_METHOD),
    deadlineMs: requireCount(budget, "deadlineMs", FS_GREP_METHOD),
    limit: requireCount(budget, "limit", FS_GREP_METHOD),
    pageUnits: requireCount(budget, "pageUnits", FS_GREP_METHOD),
    fixedReserve: 0,
  };
}

function requestOf(params: SerializableValue): GrepRequest {
  const source = paramRecord(params, FS_GREP_METHOD);
  return {
    path: requireString(source, "path", FS_GREP_METHOD),
    globSuffix: optionalString(source, "globSuffix", FS_GREP_METHOD),
    patterns: requireStringList(
      source,
      "patterns",
      FS_GREP_METHOD,
      GREP_LIMITS.maxPatterns,
    ),
    literal: requireBoolean(source, "literal", FS_GREP_METHOD),
    ignoreCase: requireBoolean(source, "ignoreCase", FS_GREP_METHOD),
    cursor: optionalString(source, "cursor", FS_GREP_METHOD),
    budget: readBudget(source),
  };
}

/**
 * The engine scope for the admitted prefix: one file when the prefix names a
 * file and no glob narrows it, otherwise the directory tree below it.
 */
async function scopeOf(
  request: GrepRequest,
  context: OperationContext,
): Promise<GrepScope> {
  const guarded = await context.guard.resolvePath(request.path);
  // The walk never starts at a link: a host grep treats one as an absent path,
  // and this Machine reports the same.
  if (guarded.isLink || guarded.kind === "missing")
    throw new GrepWalkFailure(failure("not_found", NOT_FOUND_MESSAGE));
  if (guarded.kind === "other")
    throw new GrepWalkFailure(failure("not_regular_file", NOT_REGULAR_FILE));
  const prefix = guarded.path;
  return {
    index: SCOPE_INDEX,
    locatorPrefix: prefix === "/" ? "/" : `${prefix}/`,
    port: createGrepWalkPort(
      prefix,
      guarded.canonical,
      context.guard,
      context.signal,
    ),
    glob:
      request.globSuffix === undefined
        ? undefined
        : compileGlob(request.globSuffix),
    singleFile: request.globSuffix === undefined && guarded.kind === "file",
    // The daemon never invents a locator: a passage carries the path relative
    // to the prefix, and the hub renders the `machine://` spelling.
    locatorFor: (rel) => rel,
  };
}

/**
 * One engine passage as the wire carries it: a relative path, a line range,
 * and the marks the hub paginates on. The engine's page end names the only
 * passage a page can cut — the first one, which then ends that page — so its
 * start line is the cut marker the hub reads.
 */
function passageOf(
  passage: GrepPassage,
  capped: ReadonlySet<string>,
  cutAt: number | undefined,
): FsGrepPassage {
  const separator = passage.locator.lastIndexOf(":");
  const [startLine, endLine] = passage.locator
    .slice(separator + 1)
    .split("-")
    .map(Number);
  const path = passage.locator.slice(0, separator);
  return {
    path,
    startLine,
    endLine,
    content: passage.content,
    matches: [...passage.matches],
    ...(passage.truncated === true && { truncated: true as const }),
    ...(capped.has(`${path}\u0000${String(startLine)}`) && {
      capped: true as const,
    }),
    ...(startLine === cutAt && { cut: true as const }),
  };
}

function resultOf(scan: GrepScanResult): FsGrepResult {
  // The engine names the twentieth passage of each file by its absolute
  // position, so a page that starts mid-file still marks it.
  const capped = new Set(
    (scan.capped ?? []).map(
      (entry) => `${entry.rel}\u0000${String(entry.startLine)}`,
    ),
  );
  const cutAt =
    scan.last?.endLine === undefined ? undefined : scan.last.startLine;
  const result = {
    ok: true as const,
    results: scan.results.map((passage) => passageOf(passage, capped, cutAt)),
    complete: scan.complete,
    warnings: scan.warnings.map((warning) => ({ ...warning })),
    consumed: { ...scan.consumed },
  };
  return scan.cursor === undefined
    ? result
    : { ...result, cursor: scan.cursor };
}

/** The compiled patterns, or the refusal that names the offending index. */
function compilePatterns(request: GrepRequest) {
  const oversized = request.patterns.findIndex(
    (pattern) =>
      Buffer.byteLength(pattern, "utf8") > GREP_LIMITS.maxPatternBytes,
  );
  if (oversized !== -1)
    throw invalidParams(
      FS_GREP_METHOD,
      `pattern ${String(oversized)} exceeds ${String(GREP_LIMITS.maxPatternBytes)} UTF-8 bytes`,
    );
  const compiled = compileGrepPatterns({
    patterns: request.patterns,
    literal: request.literal,
    ignoreCase: request.ignoreCase,
  });
  if (!compiled.ok)
    throw invalidParams(
      FS_GREP_METHOD,
      `pattern ${String(compiled.index)}: ${compiled.message}`,
    );
  return compiled.compiled;
}

export async function grepOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsGrepResult> {
  const request = requestOf(params);
  const patterns = compilePatterns(request);
  const inputHash = fsGrepCursorKey(request);
  const cursor =
    request.cursor === undefined
      ? undefined
      : decodeGrepCursor(request.cursor, inputHash);
  if (cursor !== undefined && "error" in cursor)
    throw invalidParams(
      FS_GREP_METHOD,
      "the cursor does not belong to this request",
    );
  const scope = await scopeOf(request, context);
  try {
    return resultOf(
      await runGrepScan({
        scopes: [scope],
        patterns,
        // The hub judges the `read` group per file on its own side; the walk
        // here opens every candidate, which is what a Machine search means.
        onCandidate: () => Promise.resolve(true),
        budget: request.budget,
        inputHash,
        now: Date.now,
        ...(cursor !== undefined && { cursor }),
      }),
    );
  } catch (error) {
    if (error instanceof GrepWalkFailure) return error.result;
    throw error;
  }
}
