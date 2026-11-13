/**
 * A first-in, first-out bound on attempts in flight to one decision provider.
 * One instance per `system-one` provider id is shared by every catalog entry
 * and every call on it, so two checkpoints behind one server share its
 * capacity. A waiter whose signal aborts leaves the queue at once and rejects
 * with the signal's reason (an `AbortError` when that reason is not an
 * `Error`); it never takes a slot.
 */
export type AttemptSlots = {
  /** Resolves with the release function once a slot is held. */
  acquire(signal?: AbortSignal): Promise<() => void>;
};

type SlotState = {
  readonly limit: number;
  inFlight: number;
  readonly waiters: Array<() => void>;
};

export function createAttemptSlots(limit: number): AttemptSlots {
  const state: SlotState = { limit, inFlight: 0, waiters: [] };

  return { acquire: (signal) => acquire(state, signal) };
}

/** Hands the slot to the oldest waiter, else frees it; a second call is a no-op. */
function releaser(state: SlotState): () => void {
  let released = false;

  return () => {
    if (released) return;
    released = true;
    const next = state.waiters.shift();

    if (next === undefined) state.inFlight -= 1;
    else next();
  };
}

function acquire(state: SlotState, signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();

  if (state.inFlight < state.limit) {
    state.inFlight += 1;

    return Promise.resolve(releaser(state));
  }

  return new Promise((resolve, reject) => {
    const grant = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(releaser(state));
    };

    const onAbort = () => {
      const index = state.waiters.indexOf(grant);

      if (index !== -1) state.waiters.splice(index, 1);
      const reason: unknown = signal?.reason;

      reject(
        reason instanceof Error
          ? reason
          : new DOMException('The slot wait was aborted.', 'AbortError'),
      );
    };

    state.waiters.push(grant);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
