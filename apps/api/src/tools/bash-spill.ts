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

import { once } from 'node:events';
import {
  artifactNotice,
  type ArtifactNoticeHostFiles,
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
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  writeToolArtifact,
  type WrittenArtifact,
} from './artifacts/artifact-writer';
import { artifactLineCount, artifactLinePieces } from './artifacts/lines';
import { formatArtifactLocator } from './artifacts/locator';
import { canReadArtifacts, readAdmitsArtifact } from './artifacts/readable';
import { artifactMaxBytes } from './artifacts/spill';
import { toToolResult } from './bash-result';
import { type ToolContext } from './types';

/** A stream that carries the executor's own output. */
export type BashObservedResult = BashKnownResult | BashTimedOutResult;

/**
 * The one omitted-range line, packaged as `prompts/bash-spill-omitted.md`: the
 * stored variant names the part and the range that holds the rest, and the
 * not-stored variant says the full result is not stored.
 */
const renderOmittedLine = loadPackagedTemplate<{
  first: number;
  last: number;
  locator?: string;
}>(__dirname, 'bash-spill-omitted');

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
  hostFilesOnly = false,
): Promise<ToolResult> {
  if (!carriesStreams(result)) return toToolResult(result);
  const streams = { stdout: result.stdout, stderr: result.stderr };

  const spilled = await spillBashStreams(
    context,
    streams,
    !result.truncated,
    hostFilesOnly,
  );

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
  hostFilesOnly = false,
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
    ...(written !== undefined && {
      notice: storedNotice(context, spilling, written, hostFilesOnly),
    }),
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

  for (;;) {
    const share = Math.floor(budget / pending.length);
    const fitting = pending.filter((name) => streams[name].length <= share);

    if (fitting.length === 0) {
      for (const name of pending) spilled[name] = share;

      return spilled;
    }

    for (const name of fitting) budget -= streams[name].length;
    pending = pending.filter((name) => streams[name].length > share);
  }
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

  for (const piece of pieces) {
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

    if (lines.length === 0) lines.push(tailCut(piece, budget));
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
  return renderOmittedLine({
    first: range.first,
    last: range.last,
    ...(written !== undefined && {
      locator: formatArtifactLocator('bash', written.seq, name),
    }),
  });
}

/**
 * The stored notice, bracket-free because the bash renderer adds the pair the
 * shared `artifactNotice` already carries. The bytes go in one artifact, so
 * one write failure loses every part of the call.
 */
function storedNotice(
  context: ToolContext,
  spilling: ReadonlyArray<SpillingStream>,
  written: WrittenArtifact,
  elsewhere: boolean,
): string {
  const parts = spilling.map((stream) => ({
    locator: formatArtifactLocator('bash', written.seq, stream.name),
    lines: artifactLineCount(stream.text),
  }));

  const notice = artifactNotice(parts, {
    hostFiles: bashHostFiles(context, written, elsewhere),
  });

  return notice.slice(1, -1);
}

/**
 * The host-file facts of the notice (tool-result-artifacts "The notice names
 * the host files"), or undefined when no file was written. A call away from
 * the llame host cannot open the directory, so only a Run that also reads the
 * artifact is told the files are on the llame host only; a Run whose only
 * route is a host `bash` is given the directory with that qualification.
 */
function bashHostFiles(
  context: ToolContext,
  written: WrittenArtifact,
  elsewhere: boolean,
): ArtifactNoticeHostFiles | undefined {
  const directory = written.hostDirectory;

  if (directory === undefined) return undefined;

  return {
    directory,
    elsewhere,
    readable: readAdmitsArtifact(context, 'bash', written.seq),
  };
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

  if (!canReadArtifacts(context, 'bash')) return undefined;

  return writeWhileLive(context, async (signal) => {
    const written = await writeToolArtifact(
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
      {
        maxBytes: artifactMaxBytes(context),
        hostFiles: context.artifactHostFiles === true,
        abortSignal: signal,
        timeoutSignal: context.timeoutSignal,
      },
    );

    // The probe before the write cannot know the counter value, so the
    // allocated locator is judged again: a denied one is never advertised, and
    // its row stays an orphan the store has no delete for (D4). A host route
    // needs the file it would name; without one only `read` reaches it.
    return (
      written.hostDirectory === undefined
        ? readAdmitsArtifact(context, 'bash', written.seq)
        : canReadArtifacts(context, 'bash', written.seq)
    )
      ? written
      : undefined;
  });
}

/**
 * Run the write while the call is still live: an aborted Run or an expired
 * call deadline publishes no locator, and a write that fails — or lands after
 * the abort — leaves the inline result as the only copy.
 */
async function writeWhileLive(
  context: ToolContext,
  write: (
    signal: AbortSignal | undefined,
  ) => Promise<WrittenArtifact | undefined>,
): Promise<WrittenArtifact | undefined> {
  const signals = [
    context.abortSignal,
    context.timeoutSignal,
    context.moveSignal,
  ].filter((signal): signal is AbortSignal => signal !== undefined);

  if (signals.some((signal) => signal.aborted)) return undefined;
  const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

  if (signal === undefined)
    return await write(undefined).catch(() => undefined);
  const aborted = once(signal, 'abort').then((): undefined => undefined);

  return await Promise.race([write(signal).catch(() => undefined), aborted]);
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
