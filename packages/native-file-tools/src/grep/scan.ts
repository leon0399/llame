import {
  encodeGrepCursor,
  grepCursorFieldUnits,
  type GrepPassageCursor,
} from "./cursor";
import { GREP_LIMITS } from "./limits";
import {
  appendGrepFile,
  createGrepPage,
  type GrepPage,
  type GrepPageLimits,
} from "./page";
import { grepFilePassages, passageEndLine, passageStartLine } from "./passages";
import type {
  GrepCappedPassage,
  GrepPassage,
  GrepScanInput,
  GrepScanResult,
  GrepScope,
  GrepWarningKind,
} from "./types";
import { walkGrepScope } from "./walk";

/** One scope's resume point, once it is known to belong to that scope. */
type GrepResume = {
  readonly cursor: GrepPassageCursor;
  readonly rel: string;
};

/** Everything one call carries across scopes and files. */
type ScanState = {
  readonly input: GrepScanInput;
  readonly page: GrepPage;
  /** What the page may serialize to, and what it keeps for its caller. */
  readonly limits: GrepPageLimits;
  /** The widest scope ordinal, which a position cursor may name. */
  readonly widestIndex: number;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  readonly deadlineAt: number;
  /** The passages that are their file's twentieth and reached the page. */
  readonly capped: Array<GrepCappedPassage>;
  readRefused: number;
  stop: GrepWarningKind | undefined;
  /** The last entry the walk finished handling, for a bound-stop cursor. */
  position: { readonly scopeIndex: number; readonly rel: string } | undefined;
  /** The scope whose walk is running, for a stop before any entry was reached. */
  scopeIndex: number | undefined;
};

/**
 * Walk every scope in submitted order and page the passages. Bounds hold
 * across the whole call; a stopped walk reports `complete: false` and a
 * cursor naming the last passage it emitted, or the last entry it reached
 * when it emitted none.
 */
export async function runGrepScan(
  input: GrepScanInput,
): Promise<GrepScanResult> {
  const state: ScanState = {
    input,
    page: createGrepPage(),
    limits: {
      pageUnits: input.budget.pageUnits,
      fixedReserve: input.budget.fixedReserve,
    },
    // A position cursor names the scope its walk stopped in; the widest
    // ordinal reserves the digits every one of them can take.
    widestIndex: input.scopes.reduce(
      (widest, scope) => Math.max(widest, scope.index),
      0,
    ),
    warnings: new Map(),
    consumed: { files: 0, entries: 0, bytes: 0 },
    deadlineAt: input.now() + input.budget.deadlineMs,
    capped: [],
    readRefused: 0,
    stop: undefined,
    position: undefined,
    scopeIndex: undefined,
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

async function scanScope(state: ScanState, scope: GrepScope): Promise<void> {
  state.scopeIndex = scope.index;
  const cursor = state.input.cursor;
  const scopeCursor =
    cursor !== undefined && cursor.scopeIndex === scope.index
      ? cursor
      : undefined;
  const resume =
    scopeCursor?.kind === "passage"
      ? { cursor: scopeCursor, rel: scopeCursor.rel }
      : undefined;
  for await (const rel of walkGrepScope({
    scope,
    cursorRel: scopeCursor?.rel,
    cursorKind: scopeCursor?.kind,
    onEntry: () => countEntry(state),
    onLink: () => addWarning(state, "link"),
    onReach: (reached) => {
      state.position = { scopeIndex: scope.index, rel: reached };
      // A stop before a passage ends the page at this entry, so the page
      // keeps the room its position cursor takes.
      state.page.reserveFloor = Math.max(
        state.page.reserveFloor,
        grepCursorFieldUnits({
          scopeIndex: state.widestIndex,
          rel: reached,
        }),
      );
    },
  })) {
    const fileResume =
      resume !== undefined && rel === resume.rel ? resume : undefined;
    // The cursor's file is exhausted: its twentieth passage hides the rest.
    if (
      fileResume?.cursor.truncated === true &&
      fileResume.cursor.endLine === undefined
    )
      continue;
    await scanFile(state, scope, rel, fileResume);
    // A stopped or full page ends the walk here, before the walker records
    // this file as reached: a later call must examine it again.
    if (state.stop !== undefined || state.page.full) return;
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
 * marked so the cursor moves past the whole file. A resumed page continues a
 * cut passage before it emits the passages after it, without repeating a line.
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
      : continuation(resume, firstTwenty, file.fileLocator);
  const twentiethAt = capped
    ? passageStartLine(firstTwenty[GREP_LIMITS.passagesPerFile - 1].locator)
    : undefined;
  const cappedAt = exhaustedAt(resume, visible) ?? twentiethAt;
  const emitted = appendGrepFile(state.page, state.limits, {
    scopeIndex: file.scopeIndex,
    rel: file.rel,
    fileLocator: file.fileLocator,
    passages: visible,
    cappedAt,
  });
  cappedMark(state, { file, visible, cappedAt, emitted });
}

/** Where one file's twentieth passage stands among the passages it emitted. */
type CappedMark = {
  readonly file: { readonly scopeIndex: number; readonly rel: string };
  readonly visible: ReadonlyArray<GrepPassage>;
  readonly cappedAt: number | undefined;
  readonly emitted: number;
};

/**
 * Remember the passage a caller may mark as its file's twentieth. The page
 * keeps passages in order and a cut one keeps its start line, so the capped
 * passage reached the page exactly when it sits before the emitted count.
 */
function cappedMark(state: ScanState, mark: CappedMark): void {
  const { file, visible, cappedAt, emitted } = mark;
  if (cappedAt === undefined) return;
  const index = visible.findIndex(
    (passage) => passageStartLine(passage.locator) === cappedAt,
  );
  if (index === -1 || index >= emitted) return;
  state.capped.push({
    scopeIndex: file.scopeIndex,
    rel: file.rel,
    startLine: cappedAt,
  });
}

/**
 * The line the cursor file is exhausted at: the rest of its twentieth passage
 * carries the twentieth semantics, so a page that ends there names it as such.
 */
function exhaustedAt(
  resume: GrepResume | undefined,
  visible: ReadonlyArray<GrepPassage>,
): number | undefined {
  if (resume?.cursor.truncated !== true || visible.length === 0)
    return undefined;
  return passageStartLine(visible[0].locator);
}

/**
 * The passages a resumed page still owes: the rest of a cut passage first,
 * then the passages after the cursor. A passage the walk no longer renders as
 * the cursor names it — the file changed between calls — falls back to the
 * lines after the cursor's start.
 */
function continuation(
  resume: GrepResume,
  passages: ReadonlyArray<GrepPassage>,
  fileLocator: string,
): Array<GrepPassage> {
  const { cursor } = resume;
  const index = passages.findIndex(
    (passage) =>
      passageStartLine(passage.locator) <= cursor.startLine &&
      cursor.startLine <= passageEndLine(passage.locator),
  );
  if (index === -1)
    return passages.filter(
      (passage) => passageStartLine(passage.locator) > cursor.startLine,
    );
  const rest = remainder(passages[index], fileLocator, cursor.endLine);
  const tail = cursor.truncated === true ? [] : passages.slice(index + 1);
  return rest === undefined ? tail : [rest, ...tail];
}

/** The lines of a passage after the line the previous page emitted. */
function remainder(
  passage: GrepPassage,
  fileLocator: string,
  endLine: number | undefined,
): GrepPassage | undefined {
  if (endLine === undefined) return undefined;
  const passageEnd = passageEndLine(passage.locator);
  if (endLine >= passageEnd) return undefined;
  const start = endLine + 1;
  const matches = passage.matches.filter((line) => line >= start);
  // Context lines alone after the cut are no passage: every passage holds a match.
  if (matches.length === 0) return undefined;
  return {
    locator: `${fileLocator}:${start}-${passageEnd}`,
    content: passage.content
      .split("\n")
      .slice(start - passageStartLine(passage.locator))
      .join("\n"),
    matches,
    ...(passage.truncated === true && { truncated: true as const }),
  };
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
  if (state.stop !== undefined) return false;
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
  const position = state.position;
  return {
    results: state.page.results,
    complete,
    cursor: complete ? undefined : cursorOf(state),
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    readRefused: state.readRefused,
    consumed: { ...state.consumed },
    ...(last !== undefined && { last: { ...last } }),
    ...(position !== undefined && { position: { ...position } }),
    ...(state.capped.length > 0 && {
      capped: state.capped.map((entry) => ({ ...entry })),
    }),
  };
}

/**
 * The last emitted passage, the last reached entry when none was emitted, or
 * — when a stop came before the walk reached anything — the first scope that
 * has not been scanned, named with an empty `rel` so its walk lists from the
 * start. Entries then count again, but a file or byte bound and the deadline
 * are fresh, so the call after it makes progress.
 */
function cursorOf(state: ScanState): string | undefined {
  const last = state.page.last;
  if (last !== undefined) {
    return encodeGrepCursor({
      scopeIndex: last.scopeIndex,
      rel: last.rel,
      startLine: last.startLine,
      endLine: last.endLine,
      truncated: last.capped ? true : undefined,
      inputHash: state.input.inputHash,
    });
  }
  const position = state.position;
  if (position === undefined) {
    // A resumed call that stopped before it reached anything past its own
    // cursor hands that cursor back: a scope restart would move behind it.
    const incoming = state.input.cursor;
    if (
      incoming !== undefined &&
      (state.scopeIndex === undefined ||
        state.scopeIndex <= incoming.scopeIndex)
    )
      return encodeGrepCursor(incoming);
    if (state.scopeIndex === undefined) return undefined;
    return encodeGrepCursor({
      kind: "position",
      scopeIndex: state.scopeIndex,
      rel: "",
      inputHash: state.input.inputHash,
    });
  }
  return encodeGrepCursor({
    kind: "position",
    scopeIndex: position.scopeIndex,
    rel: position.rel,
    inputHash: state.input.inputHash,
  });
}
