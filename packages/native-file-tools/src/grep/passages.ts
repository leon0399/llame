import { renderSourceLine } from "../source-lines";
import { GREP_LIMITS } from "./limits";
import type { CompiledGrepPatterns } from "./patterns";
import type { GrepFileStopReason, GrepPassage, GrepReadRefusal } from "./types";

/** Logical lines between cooperative yields. */
const YIELD_LINES = 256;

/**
 * Rendered passage content one scan holds at a time. The page cannot render
 * more than its own bound, so a passage that reaches this limit can only be
 * cut at a line it already holds.
 */
const HELD_CODE_UNITS = GREP_LIMITS.pageCodeUnits;

/** Why the walk dropped a file: a port refusal, a decode error, or a NUL. */
export type GrepFileRefusal =
  | GrepReadRefusal["kind"]
  | "invalid_utf8"
  | "binary";

/** Where a resumed page starts to show one file's passages. */
export interface GrepFileResume {
  /** The cursor's passage start line. */
  readonly startLine: number;
  /** The last line the previous page emitted of that passage, when cut. */
  readonly endLine?: number;
  /** The cursor's passage was the file's twentieth, so the file is exhausted. */
  readonly truncated?: boolean;
}

export interface GrepFileScanInput {
  readonly fileLocator: string;
  readonly chunks: AsyncIterable<Uint8Array | GrepReadRefusal>;
  readonly patterns: CompiledGrepPatterns;
  /** Refuse the file as `oversized` when the stream delivers more. */
  readonly maxFileBytes: number | null;
  readonly resume?: GrepFileResume;
  /**
   * Asked before each chunk: the bound that ends the read, when the file is the
   * one the walk waits on. A stop gives back the bytes read so far, so the file
   * is left unfinished instead of dropping.
   */
  readonly stop?: (bytesRead: number) => GrepFileStopReason | undefined;
  /**
   * Asked between two pattern tests of one line: only the deadline, because the
   * byte bound counts whole chunks. A stopped line ends the file as stopped, so
   * a match it still held is never lost.
   */
  readonly deadline?: () => boolean;
  /**
   * The scan's own stop signal: an aborted read ends at its next chunk and
   * closes the stream, so a file nobody will take releases its handle.
   */
  readonly signal?: AbortSignal;
}

export type GrepFileScan =
  | {
      readonly kind: "passages";
      /** At most the file's first twenty, already filtered by the resume. */
      readonly passages: ReadonlyArray<GrepPassage>;
      /** Start line of the twentieth passage when the file holds more. */
      readonly cappedAt: number | undefined;
      /** Bytes the stream delivered. */
      readonly bytes: number;
      /**
       * The hold limit ended the file before its last match, so a later call
       * must scan it again instead of treating the page as complete.
       */
      readonly holdStopped: boolean;
    }
  | {
      readonly kind: "refused";
      readonly refusal: GrepFileRefusal;
      readonly bytes: number;
    }
  | {
      readonly kind: "stopped";
      readonly reason: GrepFileStopReason;
      /** Bytes the stream delivered before the stop. */
      readonly bytes: number;
    }
  | {
      readonly kind: "aborted";
      /** Bytes the stream delivered before the abort. */
      readonly bytes: number;
    };

/**
 * Search one streamed file: logical lines follow the native read rules, a
 * window is one line each side, and passages merge and partition as they are
 * completed. The stream is read to its end before the file gives its
 * passages, so a late invalid byte or over-long line drops them all. Passages
 * hold rendered content only from the line a resumed page can show, and a
 * passage the hold limit stops is marked incomplete.
 */
export async function scanGrepFile(
  input: GrepFileScanInput,
): Promise<GrepFileScan> {
  const reader: LineReader = {
    decoder: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }),
    pieces: [],
    units: 0,
    bytes: 0,
    exact: false,
    probed: 0,
  };
  const state = createPassageState(input);
  let bytes = 0;
  let lines = 0;
  let yielded = YIELD_LINES;
  for await (const chunk of input.chunks) {
    const step = takeChunk(reader, chunk, input, bytes);
    if ("refusal" in step)
      return { kind: "refused", refusal: step.refusal, bytes };
    if ("stop" in step) return step.stop;
    bytes += step.bytes;
    lines += step.lines.length;
    const early = takeLines(state, step.lines, bytes);
    if (early !== undefined) return early;
    if (lines >= yielded) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      yielded = lines + YIELD_LINES;
    }
  }
  const last = flushLines(reader);
  if ("refusal" in last)
    return { kind: "refused", refusal: last.refusal, bytes };
  const tail = takeLines(state, last.lines, bytes);
  if (tail !== undefined) return tail;
  return { kind: "passages", ...passageResult(state), bytes };
}

/** What one chunk adds, or why the read ended before it. */
type TakeChunkStep =
  | { readonly lines: ReadonlyArray<string>; readonly bytes: number }
  | { readonly refusal: GrepFileRefusal }
  | {
      readonly stop: Extract<
        GrepFileScan,
        { readonly kind: "stopped" } | { readonly kind: "aborted" }
      >;
    };

/**
 * One chunk's guards and decode: the abort and the bound are asked before its
 * bytes, then the NUL probe, the streamed size check, and the line split.
 */
function takeChunk(
  reader: LineReader,
  chunk: Uint8Array | GrepReadRefusal,
  input: GrepFileScanInput,
  bytesRead: number,
): TakeChunkStep {
  if (input.signal?.aborted === true)
    return { stop: { kind: "aborted", bytes: bytesRead } };
  const bound = input.stop?.(bytesRead);
  if (bound !== undefined)
    return { stop: { kind: "stopped", reason: bound, bytes: bytesRead } };
  if (!(chunk instanceof Uint8Array)) return { refusal: chunk.kind };
  if (
    input.maxFileBytes !== null &&
    bytesRead + chunk.byteLength > input.maxFileBytes
  )
    return { refusal: "oversized" };
  const step = stepChunk(reader, chunk);
  return "refusal" in step
    ? step
    : { lines: step.lines, bytes: chunk.byteLength };
}

/**
 * Test and hold one chunk's completed lines in order; the stop that ended them,
 * if the deadline passed between two pattern tests or the read was aborted.
 */
function takeLines(
  state: PassageState,
  lines: ReadonlyArray<string>,
  bytes: number,
):
  | Extract<GrepFileScan, { kind: "stopped" } | { kind: "aborted" }>
  | undefined {
  const { input } = state;
  // A closure, so the loop re-reads the signal after a line's pattern tests:
  // an abort during them must end the file as aborted, not as a deadline stop.
  const aborted = (): boolean => input.signal?.aborted === true;
  for (const text of lines) {
    if (aborted()) return { kind: "aborted", bytes };
    const matched = input.patterns.matches(text, input.deadline);
    // The patterns after a stop never ran, so the line is not known to miss:
    // the file ends as stopped instead of dropping a match it still held.
    if (matched === "stopped")
      return aborted()
        ? { kind: "aborted", bytes }
        : { kind: "stopped", reason: "deadline", bytes };
    takeLine(state, text, matched);
  }
  return undefined;
}

/** One-based start line of an emitted passage locator. */
export function passageStartLine(locator: string): number {
  return Number(locator.slice(locator.lastIndexOf(":") + 1).split("-")[0]);
}

/** One-based last line of an emitted passage locator. */
export function passageEndLine(locator: string): number {
  return Number(locator.slice(locator.lastIndexOf(":") + 1).split("-")[1]);
}

/** The decode and line-splitting state one stream carries between chunks. */
type LineReader = {
  readonly decoder: TextDecoder;
  /** Decoded pieces of the line that is still open. */
  pieces: Array<string>;
  /** UTF-16 units of that line, enough to know it cannot reach the bound. */
  units: number;
  /** UTF-8 bytes of that line, counted only once it could reach the bound. */
  bytes: number;
  /** Whether `bytes` is the exact count of the open line. */
  exact: boolean;
  /** Bytes already checked for a NUL. */
  probed: number;
};

/** What one chunk added: completed lines, or the refusal that ends the read. */
type ChunkStep =
  | { readonly lines: Array<string> }
  | { readonly refusal: GrepFileRefusal };

/** Everything one chunk completes, after its NUL probe and its decode. */
function stepChunk(reader: LineReader, chunk: Uint8Array): ChunkStep {
  if (reader.probed < GREP_LIMITS.nulProbeBytes) {
    const room = GREP_LIMITS.nulProbeBytes - reader.probed;
    const head = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    if (head.includes(0)) return { refusal: "binary" };
    reader.probed += head.byteLength;
  }
  let text: string;
  try {
    text = reader.decoder.decode(chunk, { stream: true });
  } catch {
    return { refusal: "invalid_utf8" };
  }
  return splitLines(reader, text);
}

/** The lines one decoded chunk completes, and the pieces of the open one. */
function splitLines(reader: LineReader, text: string): ChunkStep {
  const lines: Array<string> = [];
  let rest = text;
  while (rest.length > 0) {
    const newline = rest.indexOf("\n");
    if (newline === -1) {
      if (!appendPiece(reader, rest)) return { refusal: "oversized" };
      break;
    }
    if (!appendPiece(reader, rest.slice(0, newline)))
      return { refusal: "oversized" };
    rest = rest.slice(newline + 1);
    const line = completeLine(reader);
    if ("refusal" in line) return line;
    lines.push(line.line);
  }
  return { lines };
}

/** Add one decoded piece to the open line; false once it outgrows the bound. */
function appendPiece(reader: LineReader, piece: string): boolean {
  reader.pieces.push(piece);
  reader.units += piece.length;
  // A UTF-16 unit never encodes to more than three UTF-8 bytes, so a short
  // line needs no exact count.
  if (!reader.exact && reader.units * 3 <= GREP_LIMITS.lineBytes) return true;
  if (!reader.exact) {
    reader.exact = true;
    reader.bytes = reader.pieces.reduce(
      (sum, part) => sum + Buffer.byteLength(part, "utf8"),
      0,
    );
  } else {
    reader.bytes += Buffer.byteLength(piece, "utf8");
  }
  // One byte of slack: the CR of a CRLF delimiter is not line content.
  return reader.bytes <= GREP_LIMITS.lineBytes + 1;
}

/** One line's text and bound, with the CR of a CRLF delimiter removed. */
function completeLine(
  reader: LineReader,
): { readonly line: string } | { readonly refusal: "oversized" } {
  const joined = reader.pieces.join("");
  const delimiter = joined.endsWith("\r") ? 1 : 0;
  const oversized =
    reader.exact && reader.bytes - delimiter > GREP_LIMITS.lineBytes;
  reader.pieces = [];
  reader.units = 0;
  reader.bytes = 0;
  reader.exact = false;
  if (oversized) return { refusal: "oversized" };
  return { line: delimiter === 1 ? joined.slice(0, -1) : joined };
}

/**
 * The file's last line, which has no delimiter: a decode error in its final
 * bytes still refuses the file, and a trailing CR stays text.
 */
function flushLines(reader: LineReader): ChunkStep {
  try {
    reader.decoder.decode();
  } catch {
    return { refusal: "invalid_utf8" };
  }
  if (reader.pieces.length === 0) return { lines: [] };
  if (reader.exact && reader.bytes > GREP_LIMITS.lineBytes)
    return { refusal: "oversized" };
  const line = reader.pieces.join("");
  reader.pieces = [];
  return { lines: [line] };
}

/** One line kept for the passages that will render it, with its `N:` prefix. */
type HeldLine = { readonly line: number; readonly text: string };

/** One finalized wandering window: one-based inclusive lines and matches. */
type GrepInterval = {
  end: number;
  matches: Array<number>;
  /** Start of the next passage this interval may emit. */
  passageStart: number;
  /** First line this interval's passages may render. */
  holdStart: number;
};

/** How far the resume filter has come through a file's passages. */
type ShowState = "pending" | "show" | "stop";

/** What a resumed page shows of one passage: none, its tail, or all of it. */
type ShowDecision =
  | { readonly kind: "drop"; readonly next: ShowState }
  | { readonly kind: "tail"; readonly from: number; readonly next: ShowState }
  | { readonly kind: "whole" };

/** Everything one file's scan carries across its lines. */
type PassageState = {
  readonly input: GrepFileScanInput;
  emitted: Array<GrepPassage>;
  /** The file's twentieth passage, once it renders, for the cap mark. */
  twentieth: GrepPassage | undefined;
  /** Start line of the file's twentieth passage, once one is finalized. */
  twentiethLine: number | undefined;
  cappedAt: number | undefined;
  /** Lines the passages that will render them need, from `heldBase`. */
  held: Array<string>;
  heldBase: number;
  heldUnits: number;
  /** The hold limit was reached: the open passage can only be cut. */
  heldStopped: boolean;
  /** A passage needed content the hold limit kept out of the buffer. */
  contentLost: boolean;
  /** Nothing more will be built: lost content or the twentieth passage. */
  stopped: boolean;
  /** Passages finalized so far, dropped ones included. */
  built: number;
  show: ShowState;
  open: GrepInterval | undefined;
  previous: HeldLine | undefined;
  /** One-based number of the last line taken. */
  line: number;
};

function createPassageState(input: GrepFileScanInput): PassageState {
  return {
    input,
    emitted: [],
    twentieth: undefined,
    twentiethLine: undefined,
    cappedAt: undefined,
    held: [],
    heldBase: 0,
    heldUnits: 0,
    heldStopped: false,
    contentLost: false,
    stopped: false,
    built: 0,
    show: input.resume === undefined ? "show" : "pending",
    open: undefined,
    previous: undefined,
    line: 0,
  };
}

function passageResult(state: PassageState) {
  // The last window of the file ends at its last line, not one past it.
  if (state.open !== undefined)
    state.open.end = Math.min(state.open.end, state.line);
  finishInterval(state);
  return {
    passages: state.emitted,
    cappedAt: state.cappedAt,
    holdStopped: state.contentLost,
  };
}

/** The 512-unit display of one line, as a flat copy of its own. */
function cutLine(text: string): string {
  return text.length > GREP_LIMITS.lineCodeUnits
    ? [text.slice(0, GREP_LIMITS.lineCodeUnits), "…"].join("")
    : text;
}

/** Take one logical line: test it, then hold it for the passages it feeds. */
function takeLine(state: PassageState, text: string, matched: boolean): void {
  state.line += 1;
  const display = cutLine(text);
  // A match opens the interval first, so the line it matched is held for the
  // window it starts; a line after one is held while it stays open.
  // `previous` stays the line before this one until both steps are done.
  if (!state.stopped) {
    if (matched) matchLine(state, state.line);
    else if (state.open !== undefined && state.line > state.open.end + 1)
      // No window can merge here any more: close it, so a long gap cannot
      // spend the hold limit on lines no passage will render.
      finishInterval(state);
    if (!state.stopped) holdLine(state, state.line, display);
  }
  state.previous = { line: state.line, text: display };
}

/** Drop held lines up to and including `through`, freeing their content. */
function releaseHeld(state: PassageState, through: number): void {
  const count = Math.min(state.held.length, through - state.heldBase + 1);
  if (count <= 0) return;
  for (const text of state.held.slice(0, count)) state.heldUnits -= text.length;
  state.held.splice(0, count);
  state.heldBase += count;
}

/** Keep one line for the passages that will render it. */
function holdLine(state: PassageState, line: number, text: string): void {
  const open = state.open;
  if (open === undefined || state.heldStopped) return;
  const floor = Math.max(open.passageStart, open.holdStart);
  if (line < floor) return;
  releaseHeld(state, floor - 1);
  if (state.held.length > 0 && state.heldBase + state.held.length !== line)
    releaseHeld(state, state.heldBase + state.held.length - 1);
  if (state.held.length === 0) state.heldBase = line;
  const rendered = renderSourceLine(text, line - 1);
  if (state.heldUnits + rendered.length > HELD_CODE_UNITS) {
    // Finalize what is held. A passage that came out incomplete needed the
    // content this line would have completed, so matching stops and the page
    // carries a continuation; a passage that ended before it frees its lines,
    // so the limit no longer blocks anything and the scan keeps matching.
    state.heldStopped = true;
    state.contentLost = false;
    finishInterval(state);
    if (state.contentLost) state.stopped = true;
    else state.heldStopped = false;
    return;
  }
  state.held.push(rendered);
  state.heldUnits += rendered.length;
}

/** The rendered lines of `[from, end]`, as far as they are held. */
function renderPassage(
  state: PassageState,
  end: number,
  from: number,
  matches: ReadonlyArray<number>,
): { readonly passage: GrepPassage; readonly last: number } | undefined {
  const wanted = matches.filter((line) => line >= from && line <= end);
  if (wanted.length === 0) return undefined;
  const lines: Array<string> = [];
  let last = from - 1;
  let incomplete = false;
  for (let line = from; line <= end; line += 1) {
    const offset = line - state.heldBase;
    const held =
      offset >= 0 && offset < state.held.length
        ? state.held[offset]
        : undefined;
    if (held === undefined) {
      incomplete = true;
      break;
    }
    lines.push(held);
    last = line;
  }
  const shown = wanted.filter((line) => line <= last);
  if (shown.length === 0) {
    // Matches exist, but none of their lines are held.
    state.contentLost = true;
    return undefined;
  }
  if (incomplete) state.contentLost = true;
  return {
    last,
    passage: {
      locator: `${state.input.fileLocator}:${from}-${last}`,
      content: lines.join("\n"),
      matches: shown,
      ...(incomplete && { incomplete: true as const }),
    },
  };
}

/** Mark the twentieth passage when a twenty-first proves the file holds more. */
function markCapped(state: PassageState): void {
  if (state.twentieth !== undefined) state.twentieth.truncated = true;
  state.cappedAt = state.twentiethLine;
  state.stopped = true;
}

/** Finish one finalized passage: drop it, or render what the page may keep. */
function emitPassage(
  state: PassageState,
  start: number,
  end: number,
  matches: ReadonlyArray<number>,
): void {
  if (state.stopped) return;
  const ordinal = state.built + 1;
  state.built = ordinal;
  if (ordinal > GREP_LIMITS.passagesPerFile) return markCapped(state);
  if (ordinal === GREP_LIMITS.passagesPerFile) state.twentiethLine = start;
  const decision = showDecision(state.show, state.input.resume, start, end);
  if (decision.kind === "drop") {
    state.show = decision.next;
    return;
  }
  if (decision.kind === "tail") state.show = decision.next;
  const from = decision.kind === "tail" ? decision.from : start;
  const rendered = renderPassage(state, end, from, matches);
  if (rendered !== undefined) {
    if (ordinal === GREP_LIMITS.passagesPerFile)
      state.twentieth = rendered.passage;
    state.emitted.push(rendered.passage);
    // The page keeps what this passage rendered; the scan drops it, so the
    // hold limit bounds the content in flight rather than the whole file.
    releaseHeld(state, rendered.last);
  }
}

/** The last match at or before `limit`, searched from `from`. */
function lastMatchWithin(
  matches: ReadonlyArray<number>,
  from: number,
  limit: number,
): number {
  let cut = from;
  while (cut + 1 < matches.length && matches[cut + 1] <= limit) cut += 1;
  return cut;
}

/** Close the open interval, partitioning what is left of it. */
function finishInterval(state: PassageState): void {
  const open = state.open;
  if (open === undefined) return;
  state.open = undefined;
  let start = open.passageStart;
  let index = 0;
  while (!state.stopped) {
    while (index < open.matches.length && open.matches[index] < start)
      index += 1;
    if (index >= open.matches.length) return;
    if (open.end - start + 1 <= GREP_LIMITS.passageLines) {
      emitPassage(state, start, open.end, open.matches.slice(index));
      return;
    }
    const cut = lastMatchWithin(
      open.matches,
      index,
      start + GREP_LIMITS.passageLines - 1,
    );
    emitPassage(
      state,
      start,
      open.matches[cut],
      open.matches.slice(index, cut + 1),
    );
    start = open.matches[cut] + 1;
    index = cut + 1;
  }
}

/** Cut the open interval at its 2,000-line passage boundary when it reaches one. */
function partitionInterval(state: PassageState, line: number): void {
  const open = state.open;
  if (open === undefined) return;
  const limit = open.passageStart + GREP_LIMITS.passageLines - 1;
  if (line <= limit) return;
  const cut = lastMatchWithin(open.matches, 0, limit);
  emitPassage(
    state,
    open.passageStart,
    open.matches[cut],
    open.matches.slice(0, cut + 1),
  );
  open.passageStart = open.matches[cut] + 1;
  open.matches = open.matches.slice(cut + 1);
}

/** Start a window at the line before a match; the line itself follows. */
function openInterval(state: PassageState, start: number, line: number): void {
  const resume = state.input.resume;
  // A resumed page shows the tail of the passage that holds its cursor, so
  // that interval holds from the line after the cursor's cut; a passage after
  // the cursor's start is shown whole and holds from its own start.
  const holdStart =
    state.show === "pending" &&
    resume !== undefined &&
    start <= resume.startLine
      ? Math.max(resume.startLine, resume.endLine ?? resume.startLine) + 1
      : start;
  state.open = {
    end: line + GREP_LIMITS.contextLines,
    matches: [line],
    passageStart: start,
    holdStart,
  };
}

/** One matched line: extend the open window, or start a new one. */
function matchLine(state: PassageState, line: number): void {
  if (state.stopped) return;
  const start = Math.max(1, line - GREP_LIMITS.contextLines);
  const sequel = line + GREP_LIMITS.contextLines;
  const open = state.open;
  if (open !== undefined && start <= open.end + 1) {
    open.end = Math.max(open.end, sequel);
    open.matches.push(line);
    partitionInterval(state, line);
    return;
  }
  finishInterval(state);
  if (state.stopped) return;
  openInterval(state, start, line);
  const previous = state.previous;
  if (previous !== undefined && previous.line === start)
    holdLine(state, previous.line, previous.text);
}

/** What a resumed page shows of one passage of the file. */
function showDecision(
  state: ShowState,
  resume: GrepFileResume | undefined,
  start: number,
  end: number,
): ShowDecision {
  if (state === "show") return { kind: "whole" };
  if (state === "stop" || resume === undefined)
    return { kind: "drop", next: "stop" };
  const next: ShowState = resume.truncated === true ? "stop" : "show";
  if (start <= resume.startLine && resume.startLine <= end) {
    return resume.endLine !== undefined && resume.endLine < end
      ? { kind: "tail", from: resume.endLine + 1, next }
      : { kind: "drop", next };
  }
  if (start > resume.startLine) return { kind: "whole" };
  return { kind: "drop", next: state };
}
