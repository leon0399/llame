/**
 * The walk's event vocabulary and the FIFO it travels through (design D2). One
 * ordered queue carries a scope start, the coalesced bookkeeping between two
 * candidates, a candidate with its started read or its refusal, and the bound
 * that stops the walk. The producer pauses at the read-ahead width — a slot is
 * held until the consumer takes the candidate — and at the queued-event cap; a
 * failure waits behind the events already queued, and a stop ends every waiter.
 */

import type { GrepPassageCursor } from "./cursor";
import type { GrepFileScan } from "./passages";
import type { GrepReadRefusal, GrepWarningKind } from "./types";

/** Events that may wait in the queue before the walk pauses (design D2). */
const MAX_QUEUED_EVENTS = 10_000;

/** A candidate's identity: the scope it belongs to and the file it names. */
type GrepCandidate = {
  readonly kind: "candidate";
  readonly scopeIndex: number;
  readonly rel: string;
  readonly fileLocator: string;
  /** The cursor's own passage, when the previous page ended in this file. */
  readonly resume: GrepPassageCursor | undefined;
};

/** One queued read: its caught outcome, and the mark the consumer raises. */
export type GrepStartedRead = {
  readonly outcome: Promise<GrepFileOutcome>;
  readonly head: number;
};

/**
 * One candidate file. `read` is absent when the `read` group refused the file,
 * so the type rules out a task a refused candidate could never have.
 */
export type GrepCandidateEvent = GrepCandidate &
  ({ readonly read: GrepStartedRead } | { readonly read: undefined });

/** One candidate with a started read, which is the only kind the consumer awaits. */
export type GrepReadEvent = GrepCandidate & { readonly read: GrepStartedRead };

/** Everything the walk hands the consumer, in canonical order. */
export type GrepWalkEvent =
  | { readonly kind: "scope"; readonly scopeIndex: number }
  | {
      readonly kind: "record";
      /** Entries the walk counted toward the entry bound. */
      readonly entries: number;
      /** Links the walk skipped. */
      readonly links: number;
      /** The last entry the walk reached, for a position cursor. */
      readonly reached: string | undefined;
      /** Directories an ignore rule excluded, in canonical order. */
      readonly ignored: ReadonlyArray<string>;
      /** More directories were excluded than could be recorded. */
      readonly ignoredAtLeast: boolean;
    }
  | { readonly kind: "stop"; readonly reason: GrepWarningKind }
  | GrepCandidateEvent;

/**
 * What one candidate's read came back with. The scan's own kinds pass through,
 * and the outcome of a refused open, a skipped file, or a failure is caught at
 * creation so a discarded read never raises an unhandled rejection.
 */
export type GrepFileOutcome =
  | GrepFileScan
  | { readonly kind: "skip"; readonly warning: GrepReadRefusal["kind"] }
  | { readonly kind: "failed"; readonly error: unknown };

/** The ordered FIFO one walk hands its events to, with its two pause bounds. */
export type WalkQueue = {
  push(event: GrepWalkEvent): Promise<boolean>;
  take(): Promise<GrepWalkEvent | undefined>;
  /** Wait until a read may start: fewer than the width, room in the queue. */
  room(): Promise<boolean>;
  /** Start one read, counted until the consumer takes its candidate. */
  start(run: () => Promise<GrepFileOutcome>): Promise<GrepFileOutcome>;
  close(): void;
  fail(error: unknown): void;
  /** Resolves once no read this queue started is still running. */
  drain(): Promise<void>;
  readonly closed: boolean;
};

/** The FIFO's own state: its events, its reads, and the waiters on both. */
type QueueState = {
  readonly width: number;
  readonly items: Array<GrepWalkEvent>;
  readonly reads: Set<Promise<GrepFileOutcome>>;
  /** Reads started and not yet taken: the read-ahead window's slots. */
  open: number;
  failure: Error | undefined;
  closed: boolean;
  waitingConsumer: (() => void) | undefined;
  waitingProducer: (() => void) | undefined;
};

export function createWalkQueue(width: number): WalkQueue {
  const state: QueueState = {
    width,
    items: [],
    reads: new Set(),
    open: 0,
    failure: undefined,
    closed: false,
    waitingConsumer: undefined,
    waitingProducer: undefined,
  };

  return {
    get closed() {
      return state.closed;
    },
    push: (event) => pushEvent(state, event),
    take: () => takeEvent(state),
    room: () =>
      waitUntil(
        state,
        () =>
          state.open < state.width && state.items.length < MAX_QUEUED_EVENTS,
      ),
    start: (run) => startRead(state, run),
    close() {
      state.closed = true;
      wake(state);
    },
    fail: (error) => failQueue(state, error),
    drain: () => Promise.all(state.reads).then(() => undefined),
  };
}

/** Hand the two waiters a turn: each re-checks its own condition. */
function wake(state: QueueState): void {
  const consumer = state.waitingConsumer;
  const producer = state.waitingProducer;
  state.waitingConsumer = undefined;
  state.waitingProducer = undefined;
  consumer?.();
  producer?.();
}

/**
 * Park the one producer until `ready` holds; false once the queue closed. Only
 * one producer ever waits, so one slot is enough.
 */
function waitUntil(state: QueueState, ready: () => boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      if (state.closed) {
        resolve(false);

        return;
      }

      if (!ready()) {
        state.waitingProducer = attempt;

        return;
      }

      resolve(true);
    };

    attempt();
  });
}

/** Queue one event when the FIFO has room; false once it closed. */
async function pushEvent(
  state: QueueState,
  event: GrepWalkEvent,
): Promise<boolean> {
  if (!(await waitUntil(state, () => state.items.length < MAX_QUEUED_EVENTS)))
    return false;
  state.items.push(event);
  wake(state);

  return true;
}

/**
 * The next event in canonical order. Events already queued come before a
 * failure, so a listing that failed ahead of the consumer cannot jump the work
 * the serial walk would have answered first.
 */
function takeEvent(state: QueueState): Promise<GrepWalkEvent | undefined> {
  return new Promise<GrepWalkEvent | undefined>((resolve, reject) => {
    const attempt = (): void => {
      const next = state.items.shift();

      if (next !== undefined) {
        if (next.kind === "candidate" && next.read !== undefined)
          state.open -= 1;
        wake(state);
        resolve(next);

        return;
      }

      if (state.failure !== undefined) {
        reject(state.failure);

        return;
      }

      if (state.closed) {
        resolve(undefined);

        return;
      }

      state.waitingConsumer = attempt;
    };

    attempt();
  });
}

/** Start one read, counted until the consumer takes its candidate. */
function startRead(
  state: QueueState,
  run: () => Promise<GrepFileOutcome>,
): Promise<GrepFileOutcome> {
  const read = run().catch((error: unknown): GrepFileOutcome => ({
    kind: "failed",
    error,
  }));

  state.reads.add(read);
  // A settled read leaves the drain set, so a long scan holds only the reads
  // that still run instead of every outcome it produced.
  void read.then(() => {
    state.reads.delete(read);
  });
  state.open += 1;

  return read;
}

/** End the queue: a waiting read and a waiting take both return now. */
function failQueue(state: QueueState, error: unknown): void {
  state.failure ??= error instanceof Error ? error : new Error(String(error));
  state.closed = true;
  wake(state);
}
