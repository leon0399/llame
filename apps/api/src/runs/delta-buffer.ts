/**
 * Delta coalescing for run-event persistence (#48/#49, SPEC §9.4).
 *
 * Persisting every model token as its own `model.delta` row would multiply
 * writes by the token count; buffering keeps the event log compact while
 * preserving full text for replay.
 *
 * Since worker execution became the default (#50), the event log IS the live
 * channel — the bridge streams what lands here. Coalescing is therefore
 * two-dimensional: flush when the buffer grows past `flushAtChars` OR when
 * `flushAfterMs` has passed since the first buffered char, whichever comes
 * first. Size alone (the v0.2 behavior) held a sub-400-char answer back
 * until stream end, so the UI showed the whole message at once instead of
 * streaming. Time is INJECTED by the caller (`push(text, nowMs)`) so the
 * buffer stays pure and deterministic — no timers; a flush can only happen
 * on a push or the final drain, so worst-case staleness is one token gap.
 */

export const DEFAULT_DELTA_FLUSH_CHARS = 400;
export const DEFAULT_DELTA_FLUSH_MS = 150;

export interface DeltaBuffer {
  /**
   * Add streamed text. Returns the coalesced chunk to persist when a flush
   * threshold (size or age) is crossed, null while still buffering.
   */
  push(text: string, nowMs?: number): string | null;
  /** Drain whatever remains (end of stream). Null when empty. */
  flush(): string | null;
}

export function createDeltaBuffer(
  flushAtChars = DEFAULT_DELTA_FLUSH_CHARS,
  flushAfterMs = DEFAULT_DELTA_FLUSH_MS,
): DeltaBuffer {
  let buffer = '';
  let firstPushMs: number | null = null;

  const drain = (): string => {
    const out = buffer;
    buffer = '';
    firstPushMs = null;
    return out;
  };

  return {
    push(text: string, nowMs?: number): string | null {
      buffer += text;
      if (firstPushMs === null && nowMs !== undefined) {
        firstPushMs = nowMs;
      }
      const aged =
        nowMs !== undefined &&
        firstPushMs !== null &&
        nowMs - firstPushMs >= flushAfterMs;
      if (buffer.length < flushAtChars && !aged) {
        return null;
      }
      return drain();
    },

    flush(): string | null {
      if (buffer.length === 0) {
        return null;
      }
      return drain();
    },
  };
}
