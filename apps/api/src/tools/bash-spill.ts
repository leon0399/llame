/**
 * `bash` stream spill (tool-result-artifacts D4). A stream that does not fit
 * its share of the inline budget is stored as one artifact part, and the model
 * reads its head lines, one omitted-range line, and its tail lines; the
 * artifact notice ends the text. This shapes a success, a `command_failed`
 * message, and a `timed_out` message alike, on the llame host, an `ssh://`
 * host, and a Machine (whose part holds the capture its protocol bound
 * allowed).
 *
 * The caller runs this inside the native fence, before `native.result`, so the
 * recorded result and the locator it carries are the inline ones. Only the
 * executor's bound counts as a bound cut; this module's cut is the inline
 * preview.
 */

import {
  artifactNotice,
  codePointSafeCutIndex,
  cutStringAtCodePointBoundary,
  RESULT_TRUNCATE_CHARS,
  type ToolResult,
} from '@workspace/runtime-safety';

import type {
  BashKnownResult,
  BashResult,
  BashTimedOutResult,
} from '@workspace/bash-executor';
import {
  writeToolArtifact,
  type WrittenArtifact,
} from './artifacts/artifact-writer';
import { artifactLineCount, artifactLinePieces } from './artifacts/lines';
import { formatArtifactLocator } from './artifacts/locator';
import { artifactMaxBytes, runCanReadArtifacts } from './artifacts/spill';
import { toToolResult } from './bash-result';
import { type ToolContext } from './types';

/** A stream that carries the executor's own output. */
export type BashObservedResult = BashKnownResult | BashTimedOutResult;

const STREAM_NAMES = ['stdout', 'stderr'] as const;
type StreamName = (typeof STREAM_NAMES)[number];

/** The two streams of one call, as the executor returned them. */
export type BashStreams = Record<StreamName, string>;

/** One stream that does not fit its inline share. */
type SpillingStream = {
  readonly name: StreamName;
  readonly text: string;
  readonly preview: StreamPreview;
};

/**
 * The preview of one over-budget stream: the lines kept at each end, and the
 * artifact line numbers in between. Line numbers are the artifact's own: a
 * source line longer than 8,000 code units counts as one line for each piece,
 * so the `read` selector in the omitted-range line addresses the stored text.
 */
export type StreamPreview = {
  readonly head: ReadonlyArray<string>;
  readonly tail: ReadonlyArray<string>;
  readonly omitted:
    | { readonly first: number; readonly last: number }
    | undefined;
};

/**
 * The tool result for one observed command: a stream that does not fit is
 * spilled and previewed, a result that fits maps as it is, and a failure the
 * executor already classified without streams passes through.
 */
export async function spillBashResult(
  context: ToolContext,
  result: BashResult,
): Promise<ToolResult> {
  if (!carriesStreams(result)) return toToolResult(result);
  const streams = { stdout: result.stdout, stderr: result.stderr };
  const spilled = await spillBashStreams(context, streams, !result.truncated);
  const inline: BashObservedResult = {
    ...result,
    stdout: spilled.streams.stdout,
    stderr: spilled.streams.stderr,
  };
  return toToolResult(
    inline,
    spilled.artifact === undefined || spilled.notice === undefined
      ? undefined
      : { artifact: spilled.artifact, notice: spilled.notice },
  );
}

/** A result whose output the executor produced, bounded or not. */
function carriesStreams(result: BashResult): result is BashObservedResult {
  if (!('type' in result)) return true;
  return result.type === 'timed_out';
}

export type SpilledBashStreams = {
  readonly streams: BashStreams;
  readonly artifact?: string;
  readonly notice?: string;
};

/**
 * Spill the streams that do not fit and render the ones that do. A failed
 * write, or a Run that cannot read artifacts, keeps the inline preview and
 * says the full result is not stored.
 */
export async function spillBashStreams(
  context: ToolContext,
  streams: BashStreams,
  complete = true,
): Promise<SpilledBashStreams> {
  const spilling = spillingStreams(streams);
  if (spilling.length === 0) return { streams };
  const written = await writeStreamParts(context, spilling, complete);
  const rendered = STREAM_NAMES.map((name) => {
    const spill = spilling.find((stream) => stream.name === name);
    return spill === undefined ? streams[name] : previewText(spill, written);
  });
  const [stdout, stderr] = rendered;
  return {
    streams: { stdout, stderr },
    ...(written !== undefined && { artifact: written.locator }),
    ...(written !== undefined && { notice: storedNotice(spilling, written) }),
  };
}

/**
 * The streams that do not fit. The inline budget is the result cap, shared
 * equally by the streams that overflow it; a stream that fits its share keeps
 * everything, and the rest is divided again until no stream fits.
 */
function spillingStreams(streams: BashStreams): Array<SpillingStream> {
  const shares = inlineShares(streams);
  return STREAM_NAMES.flatMap((name) => {
    const share = shares[name];
    if (share === undefined) return [];
    const text = streams[name];
    return [{ name, text, preview: previewStream(text, share) }];
  });
}

/** The preview budget of each stream that does not fit, keyed by name. */
function inlineShares(
  streams: BashStreams,
): Partial<Record<StreamName, number>> {
  let budget = RESULT_TRUNCATE_CHARS;
  let pending = STREAM_NAMES.filter((name) => streams[name] !== '');
  const spilled: Partial<Record<StreamName, number>> = {};
  while (pending.length > 0) {
    const share = Math.floor(budget / pending.length);
    const fitting = pending.filter((name) => streams[name].length <= share);
    if (fitting.length === 0) {
      for (const name of pending) spilled[name] = share;
      return spilled;
    }
    for (const name of fitting) budget -= streams[name].length;
    pending = pending.filter((name) => streams[name].length > share);
  }
  return spilled;
}

/** A quarter of the share is the head and the rest is the tail (D4, A5). */
const HEAD_SHARE = 4;

/**
 * The head lines, the omitted range, and the tail lines of one stream. A line
 * longer than the budget it faces is cut by code units, and every kept line is
 * measured with the newline that joins it, so the preview never exceeds its
 * share. The inline text keeps the stream's own line breaks.
 */
export function previewStream(text: string, share: number): StreamPreview {
  const pieces = artifactLinePieces(text);
  const headBudget = Math.floor(share / HEAD_SHARE);
  const head = takeHead(pieces, headBudget);
  const tail = takeTail(pieces, share - headBudget, head.consumed);
  // The first tail line is one past the last omitted line, whether that tail
  // line is whole or a cut: a cut line's front is only reachable by reading it.
  return {
    head: head.lines,
    tail: tail.lines,
    omitted:
      head.consumed < tail.start
        ? { first: head.consumed + 1, last: tail.start }
        : undefined,
  };
}

/** The lines one end of a stream keeps, and what it consumed. */
type HeadLines = {
  readonly lines: Array<string>;
  /** Pieces the head kept in full; a cut first line leaves this at zero. */
  readonly consumed: number;
};

/** The lines the tail keeps, and the index of its first whole piece. */
type TailLines = {
  readonly lines: Array<string>;
  readonly start: number;
};

/** Whole lines from the front, or one cut line when the first cannot fit. */
function takeHead(pieces: ReadonlyArray<string>, budget: number): HeadLines {
  const lines: Array<string> = [];
  let used = 0;
  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index];
    if (used + piece.length + 1 <= budget) {
      lines.push(piece);
      used += piece.length + 1;
      index += 1;
      continue;
    }
    // The line is longer than this end's whole share: cut it by code units,
    // and keep counting it as a line the head does not hold in full.
    if (lines.length === 0 && budget > 0)
      lines.push(cutStringAtCodePointBoundary(piece, budget));
    break;
  }
  return { lines, consumed: index };
}

/** Whole lines from the back, or one cut line when the last cannot fit. */
function takeTail(
  pieces: ReadonlyArray<string>,
  budget: number,
  headConsumed: number,
): TailLines {
  const lines: Array<string> = [];
  let used = 0;
  let start = pieces.length;
  while (start > headConsumed) {
    const piece = pieces[start - 1];
    if (used + piece.length + 1 <= budget) {
      lines.unshift(piece);
      used += piece.length + 1;
      start -= 1;
      continue;
    }
    if (lines.length === 0 && budget > 0) lines.push(tailCut(piece, budget));
    break;
  }
  return { lines, start };
}

/** The last `budget` code units of a line, never splitting a surrogate pair. */
function tailCut(piece: string, budget: number): string {
  const start = piece.length - budget;
  // A pair straddling the start moves the cut one unit forward, so the kept
  // text opens on a whole code point rather than a lone low surrogate.
  const safe = codePointSafeCutIndex(piece, start);
  return piece.slice(safe === start ? start : start + 1);
}

/** One stream's inline text: its head, the omitted-range line, its tail. */
function previewText(
  stream: SpillingStream,
  written: WrittenArtifact | undefined,
): string {
  const { preview } = stream;
  const lines = [...preview.head];
  if (preview.omitted !== undefined)
    lines.push(omittedLine(preview.omitted, written, stream.name));
  lines.push(...preview.tail);
  return lines.join('\n');
}

/**
 * The line the preview's cut carries. With an artifact it names the part and
 * the artifact lines that hold the rest; without one it says the full result
 * is not stored.
 */
function omittedLine(
  range: { readonly first: number; readonly last: number },
  written: WrittenArtifact | undefined,
  name: StreamName,
): string {
  const where =
    written === undefined
      ? 'full result not stored'
      : `read ${formatArtifactLocator('bash', written.seq, name)}:${range.first}-${range.last}`;
  return `[lines ${range.first}-${range.last} omitted; ${where}]`;
}

/**
 * The stored notice, bracket-free because the bash renderer adds the pair the
 * shared `artifactNotice` already carries. The bytes go in one artifact, so
 * one write failure loses every part of the call.
 */
function storedNotice(
  spilling: ReadonlyArray<SpillingStream>,
  written: WrittenArtifact,
): string {
  const parts = spilling.map((stream) => ({
    locator: formatArtifactLocator('bash', written.seq, stream.name),
    lines: artifactLineCount(stream.text),
  }));
  const notice = artifactNotice(parts);
  return notice.slice(1, -1);
}

/**
 * Store the parts of one call, or nothing at all. A Run that cannot read the
 * artifact, or a write that fails, leaves the inline result as the only copy
 * (tool-result-artifacts "An artifact is complete or absent").
 */
async function writeStreamParts(
  context: ToolContext,
  spilling: ReadonlyArray<SpillingStream>,
  complete: boolean,
): Promise<WrittenArtifact | undefined> {
  const { runId, toolCallId, userId, chatId } = context;
  if (runId === undefined || toolCallId === undefined) return undefined;
  if (!runCanReadArtifacts(context, 'bash')) return undefined;
  try {
    return await writeToolArtifact(
      context.tenantDb,
      {
        chatId,
        userId,
        runId,
        toolCallId,
        toolName: 'bash',
        // A stream the executor bound cut is incomplete: the artifact holds
        // only what the capture kept (tool-result-artifacts "An artifact is
        // complete or absent").
        complete,
        parts: spilling.map((stream) => ({
          name: stream.name,
          contentType: streamContentType(stream.text),
          content: Buffer.from(stream.text, 'utf8'),
        })),
      },
      { maxBytes: artifactMaxBytes(context) },
    );
  } catch {
    return undefined;
  }
}

/**
 * A `bash` stream is JSON when it parses as JSON and plain text otherwise
 * (D2), so a one-line JSON `stdout` reads with the JSON content type.
 */
function streamContentType(text: string): string {
  try {
    JSON.parse(text);
    return 'application/json';
  } catch {
    return 'text/plain';
  }
}
