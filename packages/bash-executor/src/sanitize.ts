import {
  PROTECTED_VALUE_REDACTION_MARKER,
  protectedValueIntervals,
  type ProtectedValueInterval,
} from "@workspace/runtime-safety";
import { cutLength, streamOutputBound, type StreamBound } from "./output-bound";
import type {
  BashExecutorContext,
  BashKnownResult,
  BashTimedOutResult,
  BashUnavailableResult,
} from "./types";

const MARKER = PROTECTED_VALUE_REDACTION_MARKER;

/**
 * What llame knows about one captured stream beyond its text. A capture that
 * llame ended (a capture or transport limit cut it, or the command timed out)
 * may stop inside a protected value, so its trailing member prefix is trimmed
 * away. A transport that kept two parts of a stream with dropped bytes between
 * them passes `gapAt`, the code-unit offset in the stream text where the gap
 * sits; each part is scanned and trimmed on its own.
 */
export type StreamCapture = {
  readonly endedByLlame: boolean;
  readonly gapAt?: number;
};

/** Per-stream capture facts; a stream without one ended by the command. */
export type ResultCaptures = {
  readonly stdout?: StreamCapture;
  readonly stderr?: StreamCapture;
};

export type ProtectedValueIntervals = ReadonlyArray<ProtectedValueInterval>;

export type SanitizedStream = {
  readonly text: string;
  readonly truncated: boolean;
};

/** The kept text with every member interval mapped to output coordinates. */
type KeptCapture = {
  readonly text: string;
  readonly intervals: ReadonlyArray<ProtectedValueInterval>;
  readonly dropped: boolean;
};

/** The members and the longest member length both streams share. */
export type Redaction = {
  readonly values: ReadonlyArray<string>;
  readonly longest: number;
};

export function requireManagedBoundary(
  context: BashExecutorContext,
): BashUnavailableResult | null {
  if (
    !context.secretBoundary ||
    !context.processIsolation ||
    streamOutputBound(context).limit <= 0 ||
    context.inputBound <= 0 ||
    context.durationMs <= 0 ||
    context.maxProcesses <= 0
  ) {
    return {
      status: "error",
      type: "boundary_missing",
      message: "Managed bash is unavailable without the required boundary.",
    };
  }

  return null;
}

/**
 * The one bash redaction routine (design D2). A stream may hold the bound plus
 * a capture lookahead, so a member starting before the bound is found whole.
 * Steps: find merged member intervals on the raw capture, trim a cut capture
 * by shortening the kept range only, cut that range at the bound, then replace
 * intersecting intervals clipped to it. A member is longer than the marker, so
 * replacement never grows the stream past the bound.
 */
export function sanitizeKnownResult<
  T extends BashKnownResult | BashTimedOutResult,
>(
  result: T,
  context: BashExecutorContext,
  protectedValues: ReadonlyArray<string> = [],
  captures: ResultCaptures = {},
): T {
  return sanitizeKnownResultAtBound(
    result,
    streamOutputBound(context),
    protectedValues,
    captures,
  );
}

/**
 * The same routine for a caller that already knows the bound's unit: the
 * Machine hub re-sanitizes the daemon's answer under the protocol's
 * code-unit bound, with no executor context to fabricate.
 */
export function sanitizeKnownResultAtBound<
  T extends BashKnownResult | BashTimedOutResult,
>(
  result: T,
  bound: StreamBound,
  protectedValues: ReadonlyArray<string> = [],
  captures: ResultCaptures = {},
): T {
  const redaction: Redaction = {
    values: protectedValues,
    longest: longestMemberLength(protectedValues),
  };

  const stdout = sanitizeStream(
    result.stdout,
    bound,
    redaction,
    captures.stdout,
  );

  const stderr = sanitizeStream(
    result.stderr,
    bound,
    redaction,
    captures.stderr,
  );

  const streams = result.truncatedStreams;

  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
    ...(streams !== undefined && {
      truncatedStreams: {
        stdout: streams.stdout || stdout.truncated,
        stderr: streams.stderr || stderr.truncated,
      },
    }),
  };
}

export function sanitizeStream(
  value: string,
  bound: StreamBound,
  redaction: Redaction,
  capture: StreamCapture | undefined,
): SanitizedStream {
  const kept = keptCapture(value, capture, redaction);
  const cut = cutLength(kept.text, bound);
  const text = replaceIntervals(kept.text, kept.intervals, cut);

  return { text, truncated: kept.dropped || cut < kept.text.length };
}

/**
 * Step 1 and 2: find intervals on the raw capture, then shorten the kept range
 * for a capture llame ended. The intervals are never re-scanned, so a drop
 * that starts inside a complete member still replaces its kept part.
 */
function keptCapture(
  value: string,
  capture: StreamCapture | undefined,
  redaction: Redaction,
): KeptCapture {
  if (capture?.gapAt !== undefined) {
    return keptGap(value, capture.gapAt, redaction);
  }

  const drop =
    capture?.endedByLlame === true
      ? trailingMemberPrefixLength(value, redaction)
      : 0;

  const keptEnd = value.length - drop;

  return {
    text: value.slice(0, keptEnd),
    intervals: clipIntervals(
      protectedValueIntervals(value, redaction.values),
      keptEnd,
    ),
    dropped: drop > 0,
  };
}

/**
 * A transport gap: each part is scanned on its own, because no member is
 * contiguous across the dropped bytes. The gap drops the head's member-prefix
 * suffix and the tail's member-suffix prefix, again only shortening the kept
 * ranges.
 */
function keptGap(
  value: string,
  gapAt: number,
  redaction: Redaction,
): KeptCapture {
  const gap = Math.max(0, Math.min(gapAt, value.length));
  const head = value.slice(0, gap);
  const tail = value.slice(gap);
  const headDrop = trailingMemberPrefixLength(head, redaction);
  const tailDrop = leadingMemberSuffixLength(tail, redaction);
  const headText = head.slice(0, head.length - headDrop);
  const tailText = tail.slice(tailDrop);

  const intervals: Array<ProtectedValueInterval> = [
    ...clipIntervals(
      protectedValueIntervals(head, redaction.values),
      headText.length,
    ),
    ...tailIntervals(tail, tailDrop, headText.length, redaction.values),
  ];

  return { text: headText + tailText, intervals, dropped: true };
}

/** Map the tail part's intervals into output coordinates, dropping the cut. */
function tailIntervals(
  tail: string,
  tailDrop: number,
  headLength: number,
  protectedValues: ReadonlyArray<string>,
): Array<ProtectedValueInterval> {
  const mapped: Array<ProtectedValueInterval> = [];

  for (const interval of protectedValueIntervals(tail, protectedValues)) {
    if (interval.end <= tailDrop) continue;
    mapped.push({
      start: headLength + Math.max(0, interval.start - tailDrop),
      end: headLength + interval.end - tailDrop,
    });
  }

  return mapped;
}

function clipIntervals(
  intervals: ReadonlyArray<ProtectedValueInterval>,
  end: number,
): Array<ProtectedValueInterval> {
  const clipped: Array<ProtectedValueInterval> = [];

  for (const interval of intervals) {
    if (interval.start >= end) break;
    clipped.push({ start: interval.start, end: Math.min(interval.end, end) });
  }

  return clipped;
}

/** Drop the longest suffix that is a proper prefix of a protected value. */
function trailingMemberPrefixLength(
  value: string,
  redaction: Redaction,
): number {
  const maxLength = Math.min(redaction.longest - 1, value.length);

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = value.slice(value.length - length);

    if (isProperMemberPrefix(suffix, redaction.values)) return length;
  }

  return 0;
}

/** Drop the longest prefix that is a proper suffix of a protected value. */
function leadingMemberSuffixLength(
  value: string,
  redaction: Redaction,
): number {
  const maxLength = Math.min(redaction.longest - 1, value.length);

  for (let length = maxLength; length > 0; length -= 1) {
    const prefix = value.slice(0, length);

    if (isProperMemberSuffix(prefix, redaction.values)) return length;
  }

  return 0;
}

function isProperMemberPrefix(
  candidate: string,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return protectedValues.some(
    (member) =>
      member.length > candidate.length && member.startsWith(candidate),
  );
}

function isProperMemberSuffix(
  candidate: string,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return protectedValues.some(
    (member) => member.length > candidate.length && member.endsWith(candidate),
  );
}

export function longestMemberLength(
  protectedValues: ReadonlyArray<string>,
): number {
  let longest = 0;

  for (const member of protectedValues) {
    longest = Math.max(longest, member.length);
  }

  return longest;
}

/**
 * Step 4: replace every merged interval that intersects the kept range,
 * clipped to it. The intervals were found once, before any drop.
 */
function replaceIntervals(
  value: string,
  intervals: ReadonlyArray<ProtectedValueInterval>,
  end: number,
): string {
  const output: Array<string> = [];
  let cursor = 0;

  for (const interval of intervals) {
    if (interval.start >= end) break;
    const clippedEnd = Math.min(interval.end, end);
    output.push(value.slice(cursor, interval.start));

    if (clippedEnd - interval.start >= MARKER.length) output.push(MARKER);
    cursor = clippedEnd;
  }

  output.push(value.slice(cursor, end));

  return output.join("");
}
