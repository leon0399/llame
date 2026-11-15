import { protectedValueIntervals } from "@workspace/runtime-safety";
import type { BashExecutorContext, ManagedOutput } from "./types";
import {
  boundedLength,
  streamOutputBound,
  type StreamBound,
} from "./output-bound";
import {
  longestMemberLength,
  sanitizeStream,
  type ProtectedValueIntervals,
  type Redaction,
  type SanitizedStream,
} from "./sanitize";

/**
 * The redacted prefix of one captured stream. A capture only grows at its end,
 * so a prefix that no protected value can cross stays the same in every later
 * snapshot, and a snapshot scans only the text after it.
 */
export type SnapshotCache = {
  /** Raw code-unit offset the cached prefix ends at. */
  offset: number;
  /** The redacted text of the raw prefix. */
  text: string;
  /** The prefix's measure against the stream bound. */
  used: number;
  /**
   * The last snapshot and the capture length it came from. A capture only
   * grows at its end, so the same length is the same text, and the snapshot of
   * an unchanged capture needs no scan at all.
   */
  last?: { readonly length: number; readonly result: SanitizedStream };
};

export function emptySnapshotCache(): SnapshotCache {
  return { offset: 0, text: "", used: 0 };
}

/**
 * The redacted snapshot of a still-running capture: what the full routine
 * returns for a capture that llame ended, without re-scanning the cached
 * prefix. The cache then moves forward as far as the lookbehind of the longest
 * protected value allows.
 */
export function sanitizeSnapshot(
  cache: SnapshotCache,
  raw: string,
  bound: StreamBound,
  values: ReadonlyArray<string>,
): SanitizedStream {
  if (cache.last?.length === raw.length) return cache.last.result;
  const redaction: Redaction = { values, longest: longestMemberLength(values) };
  const tail = raw.slice(cache.offset);

  const remaining: StreamBound = {
    kind: bound.kind,
    limit: bound.limit - cache.used,
  };

  const fresh = sanitizeStream(tail, remaining, redaction, {
    endedByLlame: true,
  });

  const result = { text: cache.text + fresh.text, truncated: fresh.truncated };
  advance(cache, raw, remaining, redaction);
  cache.last = { length: raw.length, result };

  return result;
}

function advance(
  cache: SnapshotCache,
  raw: string,
  remaining: StreamBound,
  redaction: Redaction,
): void {
  const tail = raw.slice(cache.offset);

  const end = settledEnd(
    raw,
    cache.offset,
    protectedValueIntervals(tail, redaction.values),
    raw.length - Math.max(redaction.longest - 1, 0),
  );

  if (end <= cache.offset) return;
  const part = tail.slice(0, end - cache.offset);
  const kept = sanitizeStream(part, remaining, redaction, undefined);

  // A prefix that the bound cuts is not cached: the bound decides its text.
  if (kept.truncated) return;
  cache.text += kept.text;
  cache.used += boundedLength(part, remaining);
  cache.offset = end;
}

/**
 * The largest offset up to `max` that no occurrence of a protected value can
 * cross or join, now or after more output: not inside an interval, not at its
 * end (a later occurrence starting there would merge), and not between the two
 * halves of a surrogate pair. Every occurrence that starts before `max` is
 * already whole in the capture, so backing up to an interval start or a
 * surrogate boundary is safe. A result at or below `from` means none.
 */
export function settledEnd(
  raw: string,
  from: number,
  intervals: ProtectedValueIntervals,
  max: number,
): number {
  let end = max;

  for (let moved = true; moved && end > from;) {
    moved = false;

    for (const interval of intervals) {
      if (from + interval.start < end && end <= from + interval.end) {
        end = from + interval.start;
        moved = true;
      }
    }

    const last = raw.charCodeAt(end - 1);

    if (end > from && last >= 0xd8_00 && last <= 0xdb_ff) {
      end -= 1;
      moved = true;
    }
  }

  return end;
}

type CapturedText = {
  readonly text: string;
  readonly lost: boolean;
  readonly used: number;
};

/** What a running command's watcher holds for its snapshots. */
export type SnapshotOwner = {
  readonly snapshots: {
    readonly stdout: SnapshotCache;
    readonly stderr: SnapshotCache;
  };
  readonly streams: {
    readonly stdout: CapturedText;
    readonly stderr: CapturedText;
  };
  readonly request: {
    readonly context: BashExecutorContext;
    readonly options: { readonly protectedValues?: ReadonlyArray<string> };
  };
};

export function emptySnapshotCaches(): SnapshotOwner["snapshots"] {
  return { stdout: emptySnapshotCache(), stderr: emptySnapshotCache() };
}

/** A running command's output, as `knownCloseResult` reports an ended capture. */
export function snapshotOutput(owner: SnapshotOwner): ManagedOutput {
  const bound = streamOutputBound(owner.request.context);
  const values = owner.request.options.protectedValues ?? [];
  const { stdout, stderr } = owner.streams;

  const out = sanitizeSnapshot(
    owner.snapshots.stdout,
    stdout.text,
    bound,
    values,
  );

  const err = sanitizeSnapshot(
    owner.snapshots.stderr,
    stderr.text,
    bound,
    values,
  );

  const outCut = out.truncated || stdout.lost || stdout.used > bound.limit;
  const errCut = err.truncated || stderr.lost || stderr.used > bound.limit;

  return {
    stdout: out.text,
    stderr: err.text,
    truncated: outCut || errCut,
    truncatedStreams: { stdout: outCut, stderr: errCut },
  };
}
