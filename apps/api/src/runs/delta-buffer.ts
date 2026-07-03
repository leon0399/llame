/**
 * Delta coalescing for run-event persistence (#48/#49, SPEC §9.4).
 *
 * Persisting every model token as its own `model.delta` row would multiply
 * writes by the token count; buffering by size keeps the event log compact
 * while preserving full text for replay. Deliberately size-based only (no
 * timers) so it stays pure and deterministic — replay is not the live channel
 * until the loop moves into the worker (#50); revisit granularity there.
 */

export const DEFAULT_DELTA_FLUSH_CHARS = 400;

export interface DeltaBuffer {
  /**
   * Add streamed text. Returns the coalesced chunk to persist when the
   * threshold is crossed, null while still buffering.
   */
  push(text: string): string | null;
  /** Drain whatever remains (end of stream). Null when empty. */
  flush(): string | null;
}

export function createDeltaBuffer(
  flushAtChars = DEFAULT_DELTA_FLUSH_CHARS,
): DeltaBuffer {
  let buffer = '';

  return {
    push(text: string): string | null {
      buffer += text;
      if (buffer.length < flushAtChars) {
        return null;
      }

      const out = buffer;
      buffer = '';
      return out;
    },

    flush(): string | null {
      if (buffer.length === 0) {
        return null;
      }

      const out = buffer;
      buffer = '';
      return out;
    },
  };
}
