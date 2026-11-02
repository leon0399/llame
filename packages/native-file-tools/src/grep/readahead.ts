/**
 * The read-ahead pipeline of one scan (design D2). The walk runs ahead of the
 * consumer, and every event it produces — a scope start, the bookkeeping
 * between two candidates, a candidate with its started read or its refusal, or
 * the bound that stops the walk — reaches the consumer through one ordered
 * queue. A file's read starts as soon as its candidate is queued, so its bytes
 * arrive while the consumer handles the files before it, and its outcome, a
 * failure included, is caught here and surfaces only when the consumer takes
 * it.
 */

import type { DecodedGrepCursor, GrepPassageCursor } from "./cursor";
import { GREP_LIMITS } from "./limits";
import { scanGrepFile } from "./passages";
import type { CompiledGrepPatterns } from "./patterns";
import type {
  GrepBudget,
  GrepFileStopReason,
  GrepFileStream,
  GrepScope,
} from "./types";
import { walkGrepScope } from "./walk";
import {
  createWalkQueue,
  type GrepFileOutcome,
  type GrepReadEvent,
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
}

export interface GrepWalkRun {
  /** The next event in canonical order; undefined once the walk ended. */
  take(): Promise<GrepWalkEvent | undefined>;
  /** Wait on one candidate's read, marking it the file the walk waits on. */
  awaitTask(event: GrepReadEvent): Promise<GrepFileOutcome>;
  /** End the walk and abort every read it queued. */
  stop(): void;
  /** Resolves once the walk stopped and no read it started still runs. */
  readonly done: Promise<void>;
}

/** The walk reached the entry bound while counting one more entry. */
class EntryBoundStop extends Error {}

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
  /** Directories excluded by ignore rules, counted across every scope. */
  ignored: number;
  readonly record: {
    entries: number;
    links: number;
    reached: string | undefined;
    readonly ignored: Array<string>;
    ignoredAtLeast: boolean;
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
  const state: ProducerState = {
    input,
    queue,
    signal: controller.signal,
    head: -1,
    nextHead: 0,
    entries: 0,
    started: 0,
    ignored: 0,
    streams: new Set(),
    record: {
      entries: 0,
      links: 0,
      reached: undefined,
      ignored: [],
      ignoredAtLeast: false,
    },
  };
  const done = produceWalk(state)
    .catch((error: unknown) => {
      queue.fail(error);
    })
    .then(async () => {
      queue.close();
      await queue.drain();
    });
  return {
    take: () => queue.take(),
    awaitTask: (event) => awaitTask(state, event),
    stop: () => stopProducer(state, controller),
    done,
  };
}

/** Wait on one candidate's read, marking it the file the walk waits on. */
function awaitTask(
  state: ProducerState,
  event: GrepReadEvent,
): Promise<GrepFileOutcome> {
  state.head = event.read.head;
  void event.read.outcome.then(() => {
    if (state.head === event.read.head) state.head = -1;
  });
  return event.read.outcome;
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
    if (state.queue.closed) return;
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
  const resume = scopeCursor?.kind === "passage" ? scopeCursor : undefined;
  try {
    for await (const rel of walkGrepScope({
      scope,
      cursorRel: scopeCursor?.rel,
      cursorKind: scopeCursor?.kind,
      onEntry: () => countEntry(state),
      onLink: () => {
        state.record.links += 1;
      },
      onReach: (reached) => {
        state.record.reached = reached;
      },
      onIgnored: (rel) => recordIgnored(state, scope, rel),
    })) {
      if (state.queue.closed) return true;
      // The cursor's file is exhausted: its twentieth passage hides the rest.
      if (isExhausted(resume, rel)) continue;
      if (!(await queueCandidate(state, scope, rel, resume))) return true;
    }
  } catch (error) {
    // The walk's callbacks are synchronous, so the entry bound travels as a
    // throw; the stop is one queued event after the entries it counted.
    if (!(error instanceof EntryBoundStop)) throw error;
    await emit(state, { kind: "stop", reason: "entry_bound" });
    return true;
  }
  // A scope's last directory has no candidate left to flush its bookkeeping:
  // the skip counts and the reach the cursor resumes at belong to this scope.
  await flushRecord(state);
  return false;
}

/**
 * Record one excluded directory, up to the call's cap. The producer keeps the
 * count for every scope, so a later scope's exclusions still set `atLeast`.
 */
function recordIgnored(
  state: ProducerState,
  scope: GrepScope,
  rel: string,
): void {
  if (state.ignored >= GREP_LIMITS.ignoredReported) {
    state.record.ignoredAtLeast = true;
    return;
  }
  state.ignored += 1;
  state.record.ignored.push(scope.locatorFor(rel));
}

/** Count one listed entry, or end the walk at the entry bound. */
function countEntry(state: ProducerState): boolean {
  const bound = state.input.budget.entries;
  if (bound !== null && state.entries >= bound) throw new EntryBoundStop();
  state.entries += 1;
  state.record.entries += 1;
  return true;
}

/** A cursor on a file's twentieth passage leaves nothing of it to show. */
function isExhausted(
  resume: GrepPassageCursor | undefined,
  rel: string,
): boolean {
  if (resume === undefined || resume.rel !== rel) return false;
  return resume.truncated === true && resume.endLine === undefined;
}

/**
 * One candidate: the file bound, the `read` admission, then its read. False
 * once the walk must end, which the stop event or the closed queue decided.
 */
async function queueCandidate(
  state: ProducerState,
  scope: GrepScope,
  rel: string,
  resume: GrepPassageCursor | undefined,
): Promise<boolean> {
  if (await stopBeforeCandidate(state)) return false;
  const fileLocator = scope.locatorFor(rel);
  const candidate = {
    kind: "candidate" as const,
    scopeIndex: scope.index,
    rel,
    fileLocator,
    resume: resume !== undefined && resume.rel === rel ? resume : undefined,
  };
  // The admission runs here, so a read never opens a file `read` refuses; the
  // refusal is counted by the consumer, when it takes the candidate.
  if (!(await state.input.onCandidate(fileLocator)))
    return emit(state, { ...candidate, read: undefined });
  if (!(await state.queue.room())) return false;
  state.started += 1;
  const head = state.nextHead;
  state.nextHead += 1;
  const outcome = state.queue.start(() =>
    readCandidate(state, scope, candidate, head),
  );
  return emit(state, { ...candidate, read: { outcome, head } });
}

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
  await emit(state, { kind: "stop", reason });
  return true;
}

/** One candidate's read: open, size check, and the streamed scan. */
async function readCandidate(
  state: ProducerState,
  scope: GrepScope,
  candidate: {
    readonly rel: string;
    readonly fileLocator: string;
    readonly resume: GrepPassageCursor | undefined;
  },
  head: number,
): Promise<GrepFileOutcome> {
  const { input, signal } = state;
  const { rel, fileLocator, resume } = candidate;
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
  state.streams.add(opened);
  try {
    return await scanGrepFile({
      fileLocator,
      chunks: opened.chunks,
      patterns: input.patterns,
      maxFileBytes,
      signal,
      stop: (bytesRead) => headBound(state, head, bytesRead),
      deadline: () => headDeadline(state, head),
      ...(resume !== undefined && { resume }),
    });
  } finally {
    state.streams.delete(opened);
  }
}

/**
 * The bound that ends the file the consumer waits on, asked between chunks.
 * Only that file checks: a read running ahead must not spend the call's
 * remaining bytes.
 */
function headBound(
  state: ProducerState,
  head: number,
  bytesRead: number,
): GrepFileStopReason | undefined {
  if (state.head !== head) return undefined;
  const { input } = state;
  if (input.now() > input.deadlineAt) return "deadline";
  const bytes = input.budget.bytes;
  return bytes !== null && input.consumedBytes() + bytesRead >= bytes
    ? "byte_bound"
    : undefined;
}

/**
 * Whether the deadline passed while the head file tests a line's patterns. The
 * byte bound is not asked here: it counts whole chunks, and a bound the file
 * crossed would otherwise cut the first line's remaining patterns.
 */
function headDeadline(state: ProducerState, head: number): boolean {
  return (
    state.head === head &&
    (state.signal.aborted || state.input.now() > state.input.deadlineAt)
  );
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
    record.reached === undefined &&
    record.ignored.length === 0 &&
    !record.ignoredAtLeast
  )
    return !state.queue.closed;
  const event: GrepWalkEvent = {
    kind: "record",
    entries: record.entries,
    links: record.links,
    reached: record.reached,
    ignored: [...record.ignored],
    ignoredAtLeast: record.ignoredAtLeast,
  };
  record.entries = 0;
  record.links = 0;
  record.reached = undefined;
  record.ignored.length = 0;
  record.ignoredAtLeast = false;
  return state.queue.push(event);
}
