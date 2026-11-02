import {
  encodeGrepCursor,
  grepContinuationUnits,
  type GrepPassageCursor,
} from "./cursor";
import {
  grepIgnoredUnits,
  grepUnfinishedUnits,
  grepWarningsUnits,
} from "./model-text";
import {
  appendGrepFile,
  createGrepPage,
  holdsGrownReserve,
  type GrepPage,
  type GrepPageLimits,
} from "./page";
import { passageStartLine } from "./passages";
import {
  startGrepWalk,
  type GrepCandidateEvent,
  type GrepFileOutcome,
  type GrepWalkEvent,
  type GrepWalkRun,
} from "./readahead";
import type {
  GrepCappedPassage,
  GrepPassage,
  GrepScanInput,
  GrepScanResult,
  GrepScope,
  GrepWarningKind,
} from "./types";
import { compareRel } from "./walk";

/** Everything one call carries across scopes and files. */
type ScanState = {
  readonly input: GrepScanInput;
  readonly page: GrepPage;
  /** What the page may render to, and what it keeps for its caller. */
  limits: GrepPageLimits;
  /** The widest scope ordinal, which a position cursor may name. */
  readonly widestIndex: number;
  readonly warnings: Map<GrepWarningKind, number>;
  readonly consumed: { files: number; entries: number; bytes: number };
  readonly deadlineAt: number;
  /** The entry the call starts at: its cursor's, or the first scope's start. */
  readonly startPoint:
    | { readonly scopeIndex: number; readonly rel: string }
    | undefined;
  /** Directories an ignore rule excluded, capped across the call. */
  readonly ignored: { readonly paths: Array<string>; atLeast: boolean };
  /** The passages that are their file's twentieth and reached the page. */
  readonly capped: Array<GrepCappedPassage>;
  readRefused: number;
  /** The call got past its start point; a stop no longer hides a file. */
  progressed: boolean;
  /** The file a bound stopped inside before the call progressed. */
  unfinished: string | undefined;
  stop: GrepWarningKind | undefined;
  /** A file's hold limit kept content out, so its later matches wait. */
  holdStopped: boolean;
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
  const state = createScanState(input);
  const walk = startGrepWalk({
    scopes: input.scopes,
    patterns: input.patterns,
    budget: input.budget,
    cursor: input.cursor,
    onCandidate: input.onCandidate,
    deadlineAt: state.deadlineAt,
    now: input.now,
    consumedBytes: () => state.consumed.bytes,
  });
  try {
    for (;;) {
      const event = await walk.take();
      if (event === undefined) break;
      if (await takeEvent(state, walk, event)) break;
    }
  } finally {
    // A stop, a page that filled, and an answer all end the same way: the
    // reads still queued release their files before the call returns.
    walk.stop();
    await walk.done;
  }
  return buildResult(state);
}

function createScanState(input: GrepScanInput): ScanState {
  return {
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
    startPoint: startPointOf(input),
    ignored: { paths: [], atLeast: false },
    capped: [],
    readRefused: 0,
    progressed: input.progressed === true,
    unfinished: undefined,
    stop: undefined,
    holdStopped: false,
    position: undefined,
    scopeIndex: undefined,
  };
}

/** The entry a call starts at: its cursor's, or the first scope's start. */
function startPointOf(input: GrepScanInput): ScanState["startPoint"] {
  if (input.cursor !== undefined)
    return { scopeIndex: input.cursor.scopeIndex, rel: input.cursor.rel };
  const first = input.scopes.reduce<GrepScope | undefined>(
    (earliest, scope) =>
      earliest === undefined || scope.index < earliest.index ? scope : earliest,
    undefined,
  );
  return first === undefined ? undefined : { scopeIndex: first.index, rel: "" };
}

/** Apply one walk event; true once the call stops and the walk ends. */
async function takeEvent(
  state: ScanState,
  walk: GrepWalkRun,
  event: GrepWalkEvent,
): Promise<boolean> {
  switch (event.kind) {
    case "scope":
      state.scopeIndex = event.scopeIndex;
      return false;
    case "record":
      return takeRecord(state, event);
    case "stop":
      // The serial walk checks the page before the bound: a page that filled
      // on the same file ends there, without the bound's warning.
      if (state.page.full || !pageHasFileRoom(state)) return true;
      stopAt(state, event.reason);
      return true;
    case "candidate":
      return takeCandidate(state, walk, event);
  }
}

/**
 * The bookkeeping between two candidates, applied in canonical order; true
 * once its warnings line no longer fits and the page ends before it.
 */
function takeRecord(
  state: ScanState,
  record: Extract<GrepWalkEvent, { readonly kind: "record" }>,
): boolean {
  if (record.links > 0 && !addWarning(state, "link", record.links)) return true;
  state.consumed.entries += record.entries;
  takeIgnored(state, record);
  const { reached } = record;
  const scopeIndex = state.scopeIndex;
  if (reached === undefined || scopeIndex === undefined) return false;
  state.position = { scopeIndex, rel: reached };
  // A stop before a passage ends the page at this entry, so the page keeps
  // the room its position cursor takes.
  state.page.reserveFloor = Math.max(
    state.page.reserveFloor,
    grepContinuationUnits({ scopeIndex: state.widestIndex, rel: reached }),
  );
  if (pastStartPoint(state, reached)) state.progressed = true;
  return false;
}

/**
 * Take the excluded directories a record carries, up to the call's cap, and
 * keep the room the `[ignored …]` line takes on the page.
 */
function takeIgnored(
  state: ScanState,
  record: Extract<GrepWalkEvent, { readonly kind: "record" }>,
): void {
  if (record.ignored.length === 0 && !record.ignoredAtLeast) return;
  if (record.ignoredAtLeast) state.ignored.atLeast = true;
  // The producer caps the whole call at `ignoredReported`, so every path the
  // record carries is new here.
  state.ignored.paths.push(...record.ignored);
  // The ignored line renders beside the continuation line, so it adds to the
  // reserve the page keeps back rather than replacing the cursor's room.
  state.limits = {
    ...state.limits,
    fixedReserve:
      state.input.budget.fixedReserve +
      grepIgnoredUnits({
        count: state.ignored.paths.length,
        locators: state.ignored.paths,
        atLeast: state.ignored.atLeast,
      }),
  };
}

/** Whether an entry sorts strictly after the point the call starts at. */
function pastStartPoint(state: ScanState, rel: string): boolean {
  const start = state.startPoint;
  const scopeIndex = state.scopeIndex;
  if (start === undefined || scopeIndex === undefined) return false;
  if (scopeIndex !== start.scopeIndex) return scopeIndex > start.scopeIndex;
  return compareRel(rel, start.rel) > 0;
}

/**
 * One candidate, in the order the serial walk applied it: page room, the
 * bounds, the refusal the producer recorded, then the read's outcome — which
 * only surfaces here, when the call takes the file.
 */
async function takeCandidate(
  state: ScanState,
  walk: GrepWalkRun,
  event: GrepCandidateEvent,
): Promise<boolean> {
  // A page that filled on units ends here, before any later match is read:
  // the cursor names the last passage it emitted, so a match after it would be
  // lost on resume.
  if (state.page.full || !pageHasFileRoom(state)) return true;
  const bound = boundBeforeFile(state);
  if (bound !== undefined) {
    stopAt(state, bound);
    return true;
  }
  if (event.read === undefined) {
    state.readRefused += 1;
    return false;
  }
  reserveForFile(state, event);
  return applyOutcome(state, event, await walk.awaitTask(event));
}

/** Room the position cursor that names this file takes on a stopped page. */
function reserveForFile(state: ScanState, event: GrepCandidateEvent): void {
  state.page.reserveFloor = Math.max(
    state.page.reserveFloor,
    grepContinuationUnits({
      scopeIndex: state.widestIndex,
      rel: event.rel,
    }),
  );
}

/** Apply one read's outcome; true once the call stops. */
function applyOutcome(
  state: ScanState,
  event: GrepCandidateEvent,
  outcome: GrepFileOutcome,
): boolean {
  switch (outcome.kind) {
    case "failed":
      throw outcome.error;
    case "aborted":
      // The call stopped while this read was in flight; it is discarded.
      return true;
    case "skip":
      if (!addWarning(state, outcome.warning)) return true;
      state.consumed.files += 1;
      return false;
    case "stopped":
      state.consumed.files += 1;
      state.consumed.bytes += outcome.bytes;
      stopInsideFile(state, event, outcome.reason);
      return true;
    case "refused":
      if (!addWarning(state, outcome.refusal)) return true;
      state.consumed.files += 1;
      state.consumed.bytes += outcome.bytes;
      return false;
    case "passages":
      state.consumed.files += 1;
      state.consumed.bytes += outcome.bytes;
      // A file whose hold limit kept content out may hold matches the page
      // never saw, so the call cannot claim to be complete.
      if (outcome.holdStopped) state.holdStopped = true;
      if (emitPassages(state, event, outcome)) state.progressed = true;
      return false;
  }
}

/**
 * A bound ended the file the call waited on. A call that has not progressed is
 * stuck behind it, so the result names the file and the cursor moves past it;
 * a call that progressed resumes at the file with a full budget.
 */
function stopInsideFile(
  state: ScanState,
  event: GrepCandidateEvent,
  reason: GrepWarningKind,
): void {
  // A page that cannot hold the stop's line ends before it: the file is named
  // by the next call, which re-checks the bound with a fresh one.
  if (!stopAt(state, reason)) return;
  if (state.progressed) return;
  // The page ends here with no passage to hold, so the unfinished line and
  // the cursor are what must fit; a file that completes never reserves it.
  state.page.reserveFloor = Math.max(
    state.page.reserveFloor,
    grepUnfinishedUnits(event.fileLocator),
  );
  state.unfinished = event.fileLocator;
  // A single-file scope's walk yields only `""` and ignores a cursor, so its
  // ordinal moves past the scope: the next call lists it, or none, and never
  // opens the file again.
  state.position =
    event.rel === ""
      ? { scopeIndex: event.scopeIndex + 1, rel: "" }
      : { scopeIndex: event.scopeIndex, rel: event.rel };
}

/** The bound or deadline that stops the walk before this file, if any. */
function boundBeforeFile(state: ScanState): GrepWarningKind | undefined {
  const budget = state.input.budget;
  if (budget.bytes !== null && state.consumed.bytes >= budget.bytes)
    return "byte_bound";
  if (state.input.now() > state.deadlineAt) return "deadline";
  return undefined;
}

/** One page holds at most `limit` files; reaching it ends the page. */
function pageHasFileRoom(state: ScanState): boolean {
  if (state.page.files < state.input.budget.limit) return true;
  state.page.full = true;
  return false;
}

/**
 * A file's first twenty passages reach the page, with the twentieth marked so
 * the cursor moves past the whole file. The scan already dropped the passages
 * a resumed page does not show. The count it returns is the page's progress.
 */
function emitPassages(
  state: ScanState,
  event: GrepCandidateEvent,
  scan: Extract<GrepFileOutcome, { readonly kind: "passages" }>,
): number {
  const visible = scan.passages;
  const cappedAt = exhaustedAt(event.resume, visible) ?? scan.cappedAt;
  const emitted = appendGrepFile(state.page, state.limits, {
    scopeIndex: event.scopeIndex,
    rel: event.rel,
    fileLocator: event.fileLocator,
    passages: visible,
    cappedAt,
  });
  cappedMark(state, {
    file: event,
    visible,
    cappedAt,
    emitted,
  });
  return emitted;
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
  resume: GrepPassageCursor | undefined,
  visible: ReadonlyArray<GrepPassage>,
): number | undefined {
  if (resume?.truncated !== true || visible.length === 0) return undefined;
  return passageStartLine(visible[0].locator);
}

function stopAt(state: ScanState, kind: GrepWarningKind): boolean {
  if (!addWarning(state, kind)) return false;
  state.stop = kind;
  return true;
}

/**
 * Count one warning, or end the page before it: a warnings line that no
 * longer fits beside the passages the page keeps belongs to the next call
 * (design D7). True when the count stays.
 */
function addWarning(
  state: ScanState,
  kind: GrepWarningKind,
  count = 1,
): boolean {
  const previous = state.warnings.get(kind);
  state.warnings.set(kind, (previous ?? 0) + count);
  const reserve = grepWarningsUnits(state.warnings);
  if (holdsGrownReserve(state.page, state.limits, reserve)) {
    state.page.warningReserve = reserve;
    return true;
  }
  if (previous === undefined) state.warnings.delete(kind);
  else state.warnings.set(kind, previous);
  state.page.full = true;
  return false;
}

function buildResult(state: ScanState): GrepScanResult {
  const complete =
    state.stop === undefined && !state.page.full && !state.holdStopped;
  const last = state.page.last;
  const position = state.position;
  return {
    results: state.page.results,
    complete,
    cursor: complete ? undefined : cursorOf(state),
    warnings: [...state.warnings].map(([kind, count]) => ({ kind, count })),
    readRefused: state.readRefused,
    consumed: { ...state.consumed },
    progressed: state.progressed,
    ...(state.unfinished !== undefined && { unfinished: state.unfinished }),
    ...(state.ignored.paths.length > 0 && {
      ignored: {
        paths: [...state.ignored.paths],
        atLeast: state.ignored.atLeast,
      },
    }),
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
