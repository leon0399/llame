import { encodeGrepCursor, type DecodedGrepCursor } from "./cursor";
import { GREP_LIMITS } from "./limits";
import { appendGrepFile, createGrepPage, type GrepPage } from "./page";
import { grepFilePassages, passageStartLine } from "./passages";
import type {
  GrepPassage,
  GrepScanInput,
  GrepScanResult,
  GrepScope,
  GrepWarningKind,
} from "./types";
import { walkGrepScope } from "./walk";

/** One scope's resume point, once it is known to belong to that scope. */
type GrepResume = {
  readonly cursor: DecodedGrepCursor;
  readonly rel: string;
};

/** Everything one call carries across scopes and files. */
type ScanState = {
  readonly input: GrepScanInput;
  readonly page: GrepPage;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  readonly deadlineAt: number;
  readRefused: number;
  stop: GrepWarningKind | undefined;
};

/**
 * Walk every scope in submitted order and page the passages. Bounds hold
 * across the whole call; a stopped walk reports `complete: false` and a
 * cursor whenever it emitted at least one passage.
 */
export async function runGrepScan(
  input: GrepScanInput,
): Promise<GrepScanResult> {
  const state: ScanState = {
    input,
    page: createGrepPage(),
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    deadlineAt: input.now() + input.budget.deadlineMs,
    readRefused: 0,
    stop: undefined,
  };
  for (const scope of [...input.scopes].sort(
    (left, right) => left.index - right.index,
  )) {
    if (state.stop !== undefined || state.page.full) break;
    if (input.cursor !== undefined && scope.index < input.cursor.scopeIndex)
      continue;
    await scanScope(state, scope);
  }
  return buildResult(state);
}

function resumeFor(scope: GrepScope, cursor: DecodedGrepCursor | undefined) {
  if (cursor === undefined || cursor.scopeIndex !== scope.index)
    return undefined;
  return { cursor, rel: cursor.rel };
}

async function scanScope(state: ScanState, scope: GrepScope): Promise<void> {
  const resume = resumeFor(scope, state.input.cursor);
  for await (const rel of walkGrepScope({
    scope,
    cursorRel: resume?.rel,
    onEntry: () => countEntry(state),
    onLink: () => addWarning(state, "link"),
  })) {
    if (state.stop !== undefined || state.page.full) return;
    if (resume?.cursor.truncated === true && rel === resume.rel) continue;
    // Only the cursor's own file hides the passages a page already returned.
    await scanFile(state, scope, rel, rel === resume?.rel ? resume : undefined);
  }
}

async function scanFile(
  state: ScanState,
  scope: GrepScope,
  rel: string,
  resume: GrepResume | undefined,
): Promise<void> {
  if (!pageHasFileRoom(state)) return;
  if (state.consumed.files >= state.input.budget.files)
    return stopAt(state, "file_bound");
  if (state.consumed.bytes >= state.input.budget.bytes)
    return stopAt(state, "byte_bound");
  if (state.input.now() > state.deadlineAt) return stopAt(state, "deadline");
  const fileLocator = scope.locatorFor(rel);
  if (!(await state.input.onCandidate(fileLocator))) {
    state.readRefused += 1;
    return;
  }
  const bytes = await scope.port.read(rel, GREP_LIMITS.fileBytes);
  state.consumed.files += 1;
  if (!(bytes instanceof Uint8Array)) return addWarning(state, bytes.kind);
  state.consumed.bytes += bytes.byteLength;
  if (bytes.subarray(0, GREP_LIMITS.nulProbeBytes).includes(0))
    return addWarning(state, "binary");
  const text = decodeUtf8(bytes);
  if (text === undefined) return addWarning(state, "invalid_utf8");
  const passages = await grepFilePassages(
    fileLocator,
    text,
    state.input.patterns,
  );
  emitPassages(
    state,
    { scopeIndex: scope.index, rel, fileLocator },
    passages,
    resume,
  );
}

/** One page holds at most `limit` files; reaching it ends the page. */
function pageHasFileRoom(state: ScanState): boolean {
  if (state.page.files < state.input.budget.limit) return true;
  state.page.full = true;
  return false;
}

/**
 * A file contributes its first 20 passages and no more; the twentieth is
 * marked so the cursor moves past the whole file. A resumed page hides the
 * passages the previous page already emitted, without freeing their slots.
 */
function emitPassages(
  state: ScanState,
  file: {
    readonly scopeIndex: number;
    readonly rel: string;
    readonly fileLocator: string;
  },
  passages: ReadonlyArray<GrepPassage>,
  resume: GrepResume | undefined,
): void {
  const capped = passages.length > GREP_LIMITS.passagesPerFile;
  const firstTwenty = passages.slice(0, GREP_LIMITS.passagesPerFile);
  if (capped) {
    const index = GREP_LIMITS.passagesPerFile - 1;
    firstTwenty[index] = { ...firstTwenty[index], truncated: true };
  }
  const visible =
    resume === undefined
      ? firstTwenty
      : firstTwenty.filter(
          (passage) =>
            passageStartLine(passage.locator) > resume.cursor.startLine,
        );
  appendGrepFile(state.page, state.input.budget.pageUnits, {
    scopeIndex: file.scopeIndex,
    rel: file.rel,
    fileLocator: file.fileLocator,
    passages: visible,
    cappedAt: capped
      ? passageStartLine(firstTwenty[GREP_LIMITS.passagesPerFile - 1].locator)
      : undefined,
  });
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return undefined;
  }
}

function countEntry(state: ScanState): boolean {
  if (state.consumed.entries >= state.input.budget.entries) {
    stopAt(state, "entry_bound");
    return false;
  }
  state.consumed.entries += 1;
  return true;
}

function stopAt(state: ScanState, kind: GrepWarningKind): void {
  state.stop = kind;
  addWarning(state, kind);
}

function addWarning(state: ScanState, kind: GrepWarningKind): void {
  state.warnings.set(kind, (state.warnings.get(kind) ?? 0) + 1);
}

function buildResult(state: ScanState): GrepScanResult {
  const complete = state.stop === undefined && !state.page.full;
  const last = state.page.last;
  return {
    results: state.page.results,
    complete,
    cursor:
      complete || last === undefined
        ? undefined
        : encodeGrepCursor({
            scopeIndex: last.scopeIndex,
            rel: last.rel,
            startLine: last.startLine,
            truncated: last.capped ? true : undefined,
            inputHash: state.input.inputHash,
          }),
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    readRefused: state.readRefused,
    consumed: { ...state.consumed },
  };
}
