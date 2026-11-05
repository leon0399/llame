import {
  PROTECTED_VALUE_REDACTION_MARKER,
  protectedValueIntervals,
  type ProtectedValueInterval,
} from "@workspace/runtime-safety";
import {
  boundedLength,
  cutToBound,
  streamOutputBound,
  type StreamBound,
} from "./output-bound";
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
 * may stop inside a protected value, so its trailing member prefix is dropped.
 * A transport that kept two parts of a stream with dropped bytes between them
 * passes `gapAt`, the code-unit offset in the stream text where the gap sits;
 * the routine drops the member-prefix fragment before it and the member-suffix
 * fragment after it.
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

type SanitizedStream = {
  readonly text: string;
  readonly truncated: boolean;
};

type TrimmedCapture = {
  readonly text: string;
  readonly dropped: boolean;
};

type ReplacedText = {
  readonly text: string;
  readonly markerStarts: ReadonlyArray<number>;
};

type BoundedText = {
  readonly text: string;
  readonly clipped: boolean;
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
 * Steps: trim a cut capture, find merged member intervals once, cut at the
 * bound, replace intersecting intervals clipped to it, then cut marker growth
 * without splitting a marker.
 */
export function sanitizeKnownResult<
  T extends BashKnownResult | BashTimedOutResult,
>(
  result: T,
  context: BashExecutorContext,
  protectedValues: ReadonlyArray<string> = [],
  captures: ResultCaptures = {},
): T {
  const bound = streamOutputBound(context);
  const stdout = sanitizeStream(
    result.stdout,
    bound,
    protectedValues,
    captures.stdout,
  );
  const stderr = sanitizeStream(
    result.stderr,
    bound,
    protectedValues,
    captures.stderr,
  );
  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
  };
}

function sanitizeStream(
  value: string,
  bound: StreamBound,
  protectedValues: ReadonlyArray<string>,
  capture: StreamCapture | undefined,
): SanitizedStream {
  const trimmed = trimCapture(value, capture, protectedValues);
  const intervals = protectedValueIntervals(trimmed.text, protectedValues);
  const keptLength = cutToBound(trimmed.text, bound).length;
  const replaced = replaceIntervals(trimmed.text, intervals, keptLength);
  const bounded = clampMarkerGrowth(replaced, bound);
  return {
    text: bounded.text,
    truncated:
      trimmed.dropped || keptLength !== trimmed.text.length || bounded.clipped,
  };
}

function trimCapture(
  value: string,
  capture: StreamCapture | undefined,
  protectedValues: ReadonlyArray<string>,
): TrimmedCapture {
  if (capture?.gapAt !== undefined) {
    return trimGap(value, capture.gapAt, protectedValues);
  }
  if (capture?.endedByLlame !== true) {
    return { text: value, dropped: false };
  }
  const text = dropTrailingMemberPrefix(value, protectedValues);
  return { text, dropped: text.length !== value.length };
}

/**
 * Drop the member-prefix fragment before a transport gap and the member-suffix
 * fragment after it, so neither half of a value cut by the gap survives.
 */
function trimGap(
  value: string,
  gapAt: number,
  protectedValues: ReadonlyArray<string>,
): TrimmedCapture {
  const gap = Math.max(0, Math.min(gapAt, value.length));
  const head = dropTrailingMemberPrefix(value.slice(0, gap), protectedValues);
  const tail = dropLeadingMemberSuffix(value.slice(gap), protectedValues);
  const text = head + tail;
  // A gap means the transport dropped bytes between the two parts, so the
  // capture was cut even when neither fragment matched a member.
  return { text, dropped: true };
}

/** Drop the longest suffix that is a proper prefix of a protected value. */
function dropTrailingMemberPrefix(
  value: string,
  protectedValues: ReadonlyArray<string>,
): string {
  const maxLength = Math.min(
    longestMemberLength(protectedValues) - 1,
    value.length,
  );
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = value.slice(value.length - length);
    if (isProperMemberPrefix(suffix, length, protectedValues)) {
      return value.slice(0, value.length - length);
    }
  }
  return value;
}

/** Drop the longest prefix that is a proper suffix of a protected value. */
function dropLeadingMemberSuffix(
  value: string,
  protectedValues: ReadonlyArray<string>,
): string {
  const maxLength = Math.min(
    longestMemberLength(protectedValues) - 1,
    value.length,
  );
  for (let length = maxLength; length > 0; length -= 1) {
    const prefix = value.slice(0, length);
    if (isProperMemberSuffix(prefix, length, protectedValues)) {
      return value.slice(length);
    }
  }
  return value;
}

function isProperMemberPrefix(
  candidate: string,
  length: number,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return protectedValues.some(
    (member) => member.length > length && member.startsWith(candidate),
  );
}

function isProperMemberSuffix(
  candidate: string,
  length: number,
  protectedValues: ReadonlyArray<string>,
): boolean {
  return protectedValues.some(
    (member) => member.length > length && member.endsWith(candidate),
  );
}

function longestMemberLength(protectedValues: ReadonlyArray<string>): number {
  let longest = 0;
  for (const member of protectedValues) {
    longest = Math.max(longest, member.length);
  }
  return longest;
}

/**
 * Step 4: replace every merged interval that intersects the kept range,
 * clipped to it. Markers are recorded so step 5 can cut without splitting one.
 */
function replaceIntervals(
  value: string,
  intervals: ReadonlyArray<ProtectedValueInterval>,
  keptLength: number,
): ReplacedText {
  const output: Array<string> = [];
  const markerStarts: Array<number> = [];
  let cursor = 0;
  let written = 0;
  for (const interval of intervals) {
    if (interval.start >= keptLength) break;
    const plain = value.slice(cursor, interval.start);
    output.push(plain);
    written += plain.length;
    markerStarts.push(written);
    output.push(MARKER);
    written += MARKER.length;
    cursor = Math.min(interval.end, keptLength);
  }
  output.push(value.slice(cursor, keptLength));
  return { text: output.join(""), markerStarts };
}

/**
 * Step 5: markers may make the stream longer than the bound. Cut it at the
 * bound, before any marker the cut would split, so an artifact part never
 * exceeds `tools.artifacts.maxBytes`.
 */
function clampMarkerGrowth(
  replaced: ReplacedText,
  bound: StreamBound,
): BoundedText {
  if (boundedLength(replaced.text, bound) <= bound.limit) {
    return { text: replaced.text, clipped: false };
  }
  let cut = cutToBound(replaced.text, bound).length;
  for (const markerStart of replaced.markerStarts) {
    if (markerStart < cut && markerStart + MARKER.length > cut) {
      cut = markerStart;
      break;
    }
  }
  return { text: replaced.text.slice(0, cut), clipped: true };
}
