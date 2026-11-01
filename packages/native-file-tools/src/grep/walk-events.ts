/**
 * The walk's event vocabulary and the FIFO it travels through (design D2). One
 * ordered queue carries a scope start, the coalesced bookkeeping between two
 * candidates, a candidate with its started read, and the bound that stops the
 * walk; the producer pauses at two bounds, and a stop ends every waiter.
 */

import type { GrepFileScan } from "./passages";
import type { GrepReadRefusal, GrepWarningKind } from "./types";

/** Events that may wait in the queue before the walk pauses (design D2). */
const MAX_QUEUED_EVENTS = 10_000;

/** One candidate file, with the read the producer already started for it. */
export interface GrepCandidateEvent {
  readonly kind: "candidate";
  readonly scopeIndex: number;
  readonly rel: string;
  readonly fileLocator: string;
  /** The scope names one file, so a stop inside it skips the scope's ordinal. */
  readonly singleFile: boolean;
  /** The `read` group refused the file, so no read was started. */
  readonly refused: boolean;
  /** The read's outcome; absent when the file was refused before a read. */
  readonly outcome: Promise<GrepFileOutcome> | undefined;
  /** The mark the consumer raises while it waits on this read. */
  readonly head: number;
}

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
      /** Widest continuation line any reached entry of this run takes. */
      readonly reserve: number;
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
  /** Start one read, counted until it settles, whatever its outcome. */
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
  failure: Error | undefined;
  closed: boolean;
  waitingConsumer: (() => void) | undefined;
  waitingProducer: (() => void) | undefined;
  waitingDrain: (() => void) | undefined;
};

export function createWalkQueue(width: number): WalkQueue {
  const state: QueueState = {
    width,
    items: [],
    reads: new Set(),
    failure: undefined,
    closed: false,
    waitingConsumer: undefined,
    waitingProducer: undefined,
    waitingDrain: undefined,
  };
  return {
    get closed() {
      return state.closed;
    },
    push: (event) => pushEvent(state, event),
    take: () => takeEvent(state),
    room: () => awaitRoom(state),
    start: (run) => startRead(state, run),
    close() {
      state.closed = true;
      wake(state);
    },
    fail: (error) => failQueue(state, error),
    drain: () => drainReads(state),
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

/** Queue one event once the FIFO has room; false once it closed. */
function pushEvent(state: QueueState, event: GrepWalkEvent): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      if (state.closed) {
        resolve(false);
        return;
      }
      if (state.items.length >= MAX_QUEUED_EVENTS) {
        state.waitingProducer = attempt;
        return;
      }
      state.items.push(event);
      wake(state);
      resolve(true);
    };
    attempt();
  });
}

/** The next event in canonical order; undefined once the walk ended. */
function takeEvent(state: QueueState): Promise<GrepWalkEvent | undefined> {
  return new Promise<GrepWalkEvent | undefined>((resolve, reject) => {
    const attempt = (): void => {
      if (state.failure !== undefined) {
        reject(state.failure);
        return;
      }
      const next = state.items.shift();
      if (next !== undefined) {
        wake(state);
        resolve(next);
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

/** Wait until a read may start: fewer than the width, room in the queue. */
function awaitRoom(state: QueueState): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      if (state.closed) {
        resolve(false);
        return;
      }
      if (
        state.reads.size >= state.width ||
        state.items.length >= MAX_QUEUED_EVENTS
      ) {
        state.waitingProducer = attempt;
        return;
      }
      resolve(true);
    };
    attempt();
  });
}

/** Start one read, counted until it settles, whatever its outcome. */
function startRead(
  state: QueueState,
  run: () => Promise<GrepFileOutcome>,
): Promise<GrepFileOutcome> {
  const read = run().catch((error: unknown): GrepFileOutcome => ({
    kind: "failed",
    error,
  }));
  state.reads.add(read);
  void read.then(() => {
    settleRead(state, read);
  });
  return read;
}

/** Release one read's slot: a stop or a finished file lets a new one start. */
function settleRead(state: QueueState, read: Promise<GrepFileOutcome>): void {
  state.reads.delete(read);
  if (state.reads.size === 0) {
    const drain = state.waitingDrain;
    state.waitingDrain = undefined;
    drain?.();
  }
  wake(state);
}

/** End the queue: a waiting read and a waiting take both return now. */
function failQueue(state: QueueState, error: unknown): void {
  state.failure ??= error instanceof Error ? error : new Error(String(error));
  state.closed = true;
  wake(state);
}

/** Resolves once no read this queue started is still running. */
function drainReads(state: QueueState): Promise<void> {
  if (state.reads.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    state.waitingDrain = resolve;
  });
}
