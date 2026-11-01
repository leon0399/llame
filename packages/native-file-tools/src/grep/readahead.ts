/**
 * The read-ahead pipeline of one scan (design D2). The walk runs ahead of the
 * consumer, and every event it produces — a scope start, the bookkeeping
 * between two candidates, a candidate with its started read, or the bound that
 * stops the walk — reaches the consumer through one ordered queue. A file's
 * read starts as soon as its candidate is queued, so its bytes arrive while
 * the consumer handles the files before it, and its outcome, a failure
 * included, is caught here and surfaces only when the consumer takes it.
 */

import { grepContinuationUnits } from "./cursor";
import { GREP_LIMITS } from "./limits";
import { scanGrepFile } from "./passages";
import type { CompiledGrepPatterns } from "./patterns";
import type { DecodedGrepCursor, GrepPassageCursor } from "./cursor";
import type { GrepBudget, GrepFileStream, GrepScope } from "./types";
import { walkGrepScope } from "./walk";
import {
  createWalkQueue,
  type GrepCandidateEvent,
  type GrepFileOutcome,
  type GrepWalkEvent,
  type WalkQueue,
} from "./walk-events";

export type {
  GrepCandidateEvent,
  GrepFileOutcome,
  GrepWalkEvent,
} from "./walk-events";

export interface GrepWalkInput {
  readonly scopes: ReadonlyArray<GrepScope>;
  readonly patterns: CompiledGrepPatterns;
  readonly budget: GrepBudget;
  readonly cursor: DecodedGrepCursor | undefined;
  readonly onCandidate: (locator: string) => Promise<boolean>;
  readonly deadlineAt: number;
  readonly now: () => number;
  /** Bytes the consumer has taken; the file it waits on reads against them. */
  readonly consumedBytes: () => number;
  /** Widest scope ordinal, which a position cursor may name. */
  readonly widestIndex: number;
}

export interface GrepWalkRun {
  /** The next event in canonical order; undefined once the walk ended. */
  take(): Promise<GrepWalkEvent | undefined>;
  /** Wait on one candidate's read, marking it the file the walk waits on. */
  awaitTask(event: GrepCandidateEvent): Promise<GrepFileOutcome>;
  /** End the walk and abort every read it queued. */
  stop(): void;
  /** Resolves once the walk stopped and no read it started still runs. */
  readonly done: Promise<void>;
}

/** The walk reached the entry bound while counting one more entry. */
class EntryBoundStop extends Error {}

/** One scope's resume point, once it is known to belong to that scope. */
type GrepResume = {
  readonly cursor: GrepPassageCursor;
  readonly rel: string;
};

/** The walk producer's own view: its queue, its counters, and its record. */
type ProducerState = {
  readonly input: GrepWalkInput;
  readonly queue: WalkQueue;
  readonly signal: AbortSignal;
  /** The candidate whose read the consumer waits on; -1 while it waits on none. */
  head: number;
  nextHead: number;
  /** Entries the producer counted toward the entry bound. */
  entries: number;
  /** Reads it started; a refused candidate counts no file. */
  started: number;
  /** The streams those reads still hold, which a stop releases. */
  readonly streams: Set<GrepFileStream>;
  stopping: boolean;
  readonly record: {
    entries: number;
    links: number;
    reached: string | undefined;
    reserve: number;
  };
};

/**
 * Start one call's walk. The producer runs detached from its first statement;
 * the caller takes events, and `stop` ends it and releases every read it
 * queued, so nothing keeps reading after the call answered.
 */
export function startGrepWalk(input: GrepWalkInput): GrepWalkRun {
  const queue = createWalkQueue(GREP_LIMITS.readAhead);
  const controller = new AbortController();
  const state = createProducer(input, queue, controller.signal);
  return {
    take: () => queue.take(),
    awaitTask: (event) => awaitTask(state, event),
    stop: () => stopProducer(state, controller),
    done: runProducer(state),
  };
}

function createProducer(
  input: GrepWalkInput,
  queue: WalkQueue,
  signal: AbortSignal,
): ProducerState {
  return {
    input,
    queue,
    signal,
    head: -1,
    nextHead: 0,
    entries: 0,
    started: 0,
    streams: new Set(),
    stopping: false,
    record: { entries: 0, links: 0, reached: undefined, reserve: 0 },
  };
}

/** Run the walk, then close the queue and wait for the reads it left. */
function runProducer(state: ProducerState): Promise<void> {
  return produceWalk(state)
    .catch((error: unknown) => {
      state.queue.fail(error);
    })
    .then(async () => {
      state.queue.close();
      await state.queue.drain();
    });
}

/** Wait on one candidate's read, marking it the file the walk waits on. */
function awaitTask(
  state: ProducerState,
  event: GrepCandidateEvent,
): Promise<GrepFileOutcome> {
  const outcome = event.outcome;
  if (outcome === undefined) throw new Error("a refused candidate has no read");
  state.head = event.head;
  void outcome.then(() => {
    if (state.head === event.head) state.head = -1;
  });
  return outcome;
}

/** End the walk and release every file its queued reads still hold. */
function stopProducer(state: ProducerState, controller: AbortController): void {
  state.queue.close();
  controller.abort();
  // A read the call will never take releases its file now, not when its next
  // chunk happens to arrive.
  for (const stream of state.streams) void stream.close();
}

/**
 * Walk every scope in submitted order, in canonical order, and queue what the
 * consumer applies. A bound that ends the call stops the walk where it trips.
 */
async function produceWalk(state: ProducerState): Promise<void> {
  const scopes = [...state.input.scopes].sort(
    (left, right) => left.index - right.index,
  );
  for (const scope of scopes) {
    if (state.stopping || state.queue.closed) return;
    const cursor = state.input.cursor;
    if (cursor !== undefined && scope.index < cursor.scopeIndex) continue;
    const scopeCursor =
      cursor !== undefined && cursor.scopeIndex === scope.index
        ? cursor
        : undefined;
    if (
      !(await state.queue.push({
        kind: "scope",
        scopeIndex: scope.index,
      }))
    )
      return;
    if (await walkScope(state, scope, scopeCursor)) return;
  }
}

/** One scope's candidates; true once the call stops and the walk must end. */
async function walkScope(
  state: ProducerState,
  scope: GrepScope,
  scopeCursor: DecodedGrepCursor | undefined,
): Promise<boolean> {
  const resume: GrepResume | undefined =
    scopeCursor?.kind === "passage"
      ? { cursor: scopeCursor, rel: scopeCursor.rel }
      : undefined;
  try {
    for await (const rel of walkGrepScope({
      scope,
      cursorRel: scopeCursor?.rel,
      cursorKind: scopeCursor?.kind,
      onEntry: () => countEntry(state),
      onLink: () => {
        state.record.links += 1;
      },
      onReach: (reached) => reachEntry(state, reached),
    })) {
      if (state.stopping || state.queue.closed) return true;
      // The cursor's file is exhausted: its twentieth passage hides the rest.
      if (isExhausted(resume, rel)) continue;
      if (!(await takeCandidate(state, scope, rel, resume))) return true;
    }
  } catch (error) {
    // The walk's callbacks are synchronous, so the entry bound travels as a
    // throw; the stop is one queued event after the entries it counted.
    if (!(error instanceof EntryBoundStop)) throw error;
    state.stopping = true;
    await emit(state, { kind: "stop", reason: "entry_bound" });
    return true;
  }
  // A scope's last directory has no candidate left to flush its bookkeeping:
  // the skip counts and the reach the cursor resumes at belong to this scope.
  await flushRecord(state);
  return state.stopping;
}

/** Count one listed entry, or end the walk at the entry bound. */
function countEntry(state: ProducerState): boolean {
  const bound = state.input.budget.entries;
  if (bound !== null && state.entries >= bound) throw new EntryBoundStop();
  state.entries += 1;
  state.record.entries += 1;
  return true;
}

/** Record one reached entry: the position cursor, and the room it needs. */
function reachEntry(state: ProducerState, rel: string): void {
  state.record.reached = rel;
  state.record.reserve = Math.max(
    state.record.reserve,
    grepContinuationUnits({ scopeIndex: state.input.widestIndex, rel }),
  );
}

/** A cursor on a file's twentieth passage leaves nothing of it to show. */
function isExhausted(resume: GrepResume | undefined, rel: string): boolean {
  if (resume === undefined || resume.rel !== rel) return false;
  return (
    resume.cursor.truncated === true && resume.cursor.endLine === undefined
  );
}

/**
 * One candidate: the file bound, the `read` admission, then its read. False
 * once the walk must end, which the stop event or the closed queue decided.
 */
async function takeCandidate(
  state: ProducerState,
  scope: GrepScope,
  rel: string,
  resume: GrepResume | undefined,
): Promise<boolean> {
  if (await stopBeforeCandidate(state)) return false;
  const fileLocator = scope.locatorFor(rel);
  const candidate: CandidateHead = {
    scopeIndex: scope.index,
    rel,
    fileLocator,
    singleFile: scope.singleFile,
  };
  // The admission runs here, so a read never opens a file `read` refuses; the
  // refusal is counted by the consumer, when it takes the candidate.
  if (!(await state.input.onCandidate(fileLocator)))
    return emit(state, {
      ...candidate,
      kind: "candidate",
      refused: true,
      outcome: undefined,
      head: -1,
    });
  return startCandidateRead(state, candidate, scope, resume);
}

/** A candidate's identity: the scope it belongs to and the file it names. */
type CandidateHead = {
  readonly scopeIndex: number;
  readonly rel: string;
  readonly fileLocator: string;
  readonly singleFile: boolean;
};

/**
 * The bound that stops the walk before another candidate: the file bound the
 * producer has used up, or a byte bound the consumer already reached. The stop
 * is one queued event, after the bookkeeping that precedes it.
 */
async function stopBeforeCandidate(state: ProducerState): Promise<boolean> {
  const { budget } = state.input;
  const reason =
    budget.files !== null && state.started >= budget.files
      ? "file_bound"
      : budget.bytes !== null && state.input.consumedBytes() >= budget.bytes
        ? "byte_bound"
        : undefined;
  if (reason === undefined) return false;
  state.stopping = true;
  await emit(state, { kind: "stop", reason });
  return true;
}

/** Queue one candidate and start its read, once a read slot is free. */
async function startCandidateRead(
  state: ProducerState,
  candidate: CandidateHead,
  scope: GrepScope,
  resume: GrepResume | undefined,
): Promise<boolean> {
  // The pause belongs before the open: no read starts past the read-ahead
  // width, which is what keeps at most that many files open.
  if (!(await state.queue.room())) return false;
  state.started += 1;
  const head = state.nextHead;
  state.nextHead += 1;
  const read: ProducerRead = {
    scope,
    rel: candidate.rel,
    fileLocator: candidate.fileLocator,
    head,
    resume,
  };
  const outcome = state.queue.start(() => readCandidate(state, read));
  return emit(state, {
    ...candidate,
    kind: "candidate",
    refused: false,
    outcome,
    head,
  });
}

/** One read the producer starts: its file, its head mark, and its resume. */
type ProducerRead = {
  readonly scope: GrepScope;
  readonly rel: string;
  readonly fileLocator: string;
  readonly head: number;
  readonly resume: GrepResume | undefined;
};

/** One candidate's read: open, size check, and the streamed scan. */
async function readCandidate(
  state: ProducerState,
  read: ProducerRead,
): Promise<GrepFileOutcome> {
  const { input, signal } = state;
  const { scope, rel, fileLocator, head, resume } = read;
  if (signal.aborted) return { kind: "aborted", bytes: 0 };
  const opened = await scope.port.open(rel);
  // The call may have stopped while the open waited; a stream nobody reads
  // owes its handle to this close.
  if (signal.aborted) {
    if ("chunks" in opened) await opened.close();
    return { kind: "aborted", bytes: 0 };
  }
  if (!("chunks" in opened)) return { kind: "skip", warning: opened.kind };
  const maxFileBytes = input.budget.maxFileBytes;
  if (maxFileBytes !== null && opened.size > maxFileBytes) {
    // A stream nobody started owes its handle to this refusal.
    await opened.close();
    return { kind: "skip", warning: "oversized" };
  }
  // Only the cursor's own file resumes mid-file; the files after it start
  // from their first line.
  const fileResume = resume !== undefined && resume.rel === rel;
  state.streams.add(opened);
  try {
    return await scanGrepFile({
      fileLocator,
      chunks: opened.chunks,
      patterns: input.patterns,
      maxFileBytes,
      signal,
      stop: (bytesRead) => stopInsideFile(state, head, bytesRead),
      ...(fileResume && resume !== undefined && { resume: resume.cursor }),
    });
  } finally {
    state.streams.delete(opened);
  }
}

/**
 * The bound that ends the file the consumer waits on. Only that file checks
 * them: a read running ahead must not spend the call's remaining bytes, and a
 * stop of its own would discard the file the consumer has not taken yet.
 */
function stopInsideFile(
  state: ProducerState,
  head: number,
  bytesRead: number,
): "deadline" | "byte_bound" | undefined {
  if (state.head !== head) return undefined;
  const { input } = state;
  if (input.now() > input.deadlineAt) return "deadline";
  const bytes = input.budget.bytes;
  return bytes !== null && input.consumedBytes() + bytesRead >= bytes
    ? "byte_bound"
    : undefined;
}

/** Queue one event after the bookkeeping that precedes it. */
async function emit(
  state: ProducerState,
  event: GrepWalkEvent,
): Promise<boolean> {
  if (!(await flushRecord(state))) return false;
  return state.queue.push(event);
}

/** Queue the counted entries, skips, and reaches of the walk so far. */
async function flushRecord(state: ProducerState): Promise<boolean> {
  const record = state.record;
  if (
    record.entries === 0 &&
    record.links === 0 &&
    record.reached === undefined
  )
    return !state.queue.closed;
  const event: GrepWalkEvent = {
    kind: "record",
    entries: record.entries,
    links: record.links,
    reached: record.reached,
    reserve: record.reserve,
  };
  record.entries = 0;
  record.links = 0;
  record.reached = undefined;
  record.reserve = 0;
  return state.queue.push(event);
}
