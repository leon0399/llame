import { renderSourceLine } from "../source-lines";
import { GREP_LIMITS } from "./limits";
import type { CompiledGrepPatterns } from "./patterns";
import type { GrepPassage, GrepReadRefusal } from "./types";

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
    }
  | {
      readonly kind: "refused";
      readonly refusal: GrepFileRefusal;
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
  const counter = { bytes: 0 };
  const state = createPassageState(input);
  for await (const event of readGrepLines(
    input.chunks,
    input.maxFileBytes,
    counter,
  )) {
    if (event.kind === "refused")
      return { kind: "refused", refusal: event.refusal, bytes: counter.bytes };
    takeLine(state, event.text);
  }
  return { kind: "passages", ...passageResult(state), bytes: counter.bytes };
}

/** One-based start line of an emitted passage locator. */
export function passageStartLine(locator: string): number {
  return Number(locator.slice(locator.lastIndexOf(":") + 1).split("-")[0]);
}

/** One-based last line of an emitted passage locator. */
export function passageEndLine(locator: string): number {
  return Number(locator.slice(locator.lastIndexOf(":") + 1).split("-")[1]);
}

/** One logical line of the stream, or the refusal that ends the read. */
type GrepLineEvent =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "refused"; readonly refusal: GrepFileRefusal };

/** The decode and line-splitting state one stream carries between chunks. */
type LineReader = {
  readonly decoder: TextDecoder;
  /** Decoded pieces of the line that is still open. */
  pieces: Array<string>;
  /** UTF-8 bytes of that line, its delimiter excluded. */
  bytes: number;
  /** Bytes already checked for a NUL. */
  probed: number;
};

/** What one chunk added: completed lines, or the refusal that ends the read. */
type ChunkStep =
  | { readonly lines: Array<string> }
  | { readonly refusal: GrepFileRefusal };

/**
 * Decode and split one file's chunks into logical lines. A BOM is content,
 * LF ends a line, and a CR before it stays text until the line completes, so
 * a chunk boundary needs no special case. A file with a NUL in its first
 * 8 KiB ends the read as `binary`, a line above the byte bound as
 * `oversized`, and a byte the UTF-8 decoder rejects as `invalid_utf8`.
 */
async function* readGrepLines(
  chunks: AsyncIterable<Uint8Array | GrepReadRefusal>,
  maxFileBytes: number | null,
  counter: { bytes: number },
): AsyncGenerator<GrepLineEvent> {
  const reader: LineReader = {
    decoder: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }),
    pieces: [],
    bytes: 0,
    probed: 0,
  };
  let lines = 0;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      yield { kind: "refused", refusal: chunk.kind };
      return;
    }
    counter.bytes += chunk.byteLength;
    if (maxFileBytes !== null && counter.bytes > maxFileBytes) {
      yield { kind: "refused", refusal: "oversized" };
      return;
    }
    const step = stepChunk(reader, chunk);
    if ("refusal" in step) {
      yield { kind: "refused", refusal: step.refusal };
      return;
    }
    for (const line of step.lines) {
      lines += 1;
      if (lines % YIELD_LINES === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
      yield { kind: "line", text: line };
    }
  }
  const last = flushLines(reader);
  if ("refusal" in last) yield { kind: "refused", refusal: last.refusal };
  else for (const line of last.lines) yield { kind: "line", text: line };
}

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
    lines.push(joinLine(reader.pieces, true));
    reader.pieces = [];
    reader.bytes = 0;
  }
  return { lines };
}

/** Add one decoded piece to the open line; false once it outgrows the bound. */
function appendPiece(reader: LineReader, piece: string): boolean {
  reader.pieces.push(piece);
  reader.bytes += Buffer.byteLength(piece, "utf8");
  return reader.bytes <= GREP_LIMITS.lineBytes;
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
  const line = joinLine(reader.pieces, false);
  reader.pieces = [];
  return { lines: [line] };
}

/**
 * One line's text: its decoded pieces joined, with the CR of a CRLF delimiter
 * removed when the line was terminated.
 */
function joinLine(pieces: ReadonlyArray<string>, terminated: boolean): string {
  const line = pieces.join("");
  return terminated && line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** One line kept for the passages that will render it, with its `N:` prefix. */
type HeldLine = { readonly line: number; readonly text: string };

/** One finalized wandering window: one-based inclusive lines and matches. */
type GrepInterval = {
  start: number;
  end: number;
  matches: Array<number>;
  /** Start of the next passage this interval may emit. */
  passageStart: number;
  /** First line this interval's passages may render. */
  holdStart: number;
};

/** How far the resume filter has come through a file's passages. */
type ShowState =
  | { readonly kind: "pending" }
  | { readonly kind: "show" }
  | { readonly kind: "stop" };

/** What a resumed page shows of one passage: none, its tail, or all of it. */
type ShowDecision =
  | { readonly kind: "drop"; readonly next: ShowState }
  | { readonly kind: "tail"; readonly from: number; readonly next: ShowState }
  | { readonly kind: "whole" };

/** Everything one file's scan carries across its lines. */
type PassageState = {
  readonly input: GrepFileScanInput;
  readonly resume: GrepFileResume | undefined;
  /** Passages in canonical order, with the ordinal each holds in the file. */
  emitted: Array<{ ordinal: number; passage: GrepPassage }>;
  /** Lines the passages that will render them need, from `heldBase`. */
  held: Array<string>;
  heldBase: number;
  heldUnits: number;
  /** The hold limit was reached: the open passage can only be cut. */
  heldStopped: boolean;
  /** Nothing more will be built: the hold limit or the twentieth passage. */
  stopped: boolean;
  /** Passages finalized so far, dropped ones included. */
  built: number;
  /** Start line of the file's twentieth passage, once one is finalized. */
  twentiethLine: number | undefined;
  cappedAt: number | undefined;
  show: ShowState;
  open: GrepInterval | undefined;
  previous: HeldLine | undefined;
  /** One-based number of the last line taken. */
  line: number;
};

function createPassageState(input: GrepFileScanInput): PassageState {
  return {
    input,
    resume: input.resume,
    emitted: [],
    held: [],
    heldBase: 0,
    heldUnits: 0,
    heldStopped: false,
    stopped: false,
    built: 0,
    twentiethLine: undefined,
    cappedAt: undefined,
    show: input.resume === undefined ? { kind: "show" } : { kind: "pending" },
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
    passages: state.emitted.map((entry) => entry.passage),
    cappedAt: state.cappedAt,
  };
}

/** Take one logical line: test it, then hold it for the passages it feeds. */
function takeLine(state: PassageState, text: string): void {
  state.line += 1;
  const display =
    text.length > GREP_LIMITS.lineCodeUnits
      ? `${text.slice(0, GREP_LIMITS.lineCodeUnits)}…`
      : text;
  // A match opens the interval first, so the line it matched is held for the
  // window it starts; a line after one is held while it stays open.
  // `previous` stays the line before this one until both steps are done.
  if (!state.stopped) {
    if (state.input.patterns.matches(text)) matchLine(state, state.line);
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
  if (state.held.length > 0 && state.heldBase + state.held.length !== line) {
    for (const held of state.held) state.heldUnits -= held.length;
    state.held = [];
  }
  if (state.held.length === 0) state.heldBase = line;
  const rendered = renderSourceLine(text, line - 1);
  if (state.heldUnits + rendered.length > HELD_CODE_UNITS) {
    state.heldStopped = true;
    finishInterval(state);
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
  if (shown.length === 0) return undefined;
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
  const twentieth = state.emitted.find(
    (entry) => entry.ordinal === GREP_LIMITS.passagesPerFile,
  );
  if (twentieth !== undefined) twentieth.passage.truncated = true;
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
  const decision = showDecision(state.show, state.resume, start, end);
  if (decision.kind === "drop") {
    state.show = decision.next;
    if (state.heldStopped) state.stopped = true;
    return;
  }
  if (decision.kind === "tail") state.show = decision.next;
  const from = decision.kind === "tail" ? decision.from : start;
  const rendered = renderPassage(state, end, from, matches);
  if (rendered !== undefined) {
    state.emitted.push({ ordinal, passage: rendered.passage });
    // The page keeps what this passage rendered; the scan drops it, so the
    // hold limit bounds the content in flight rather than the whole file.
    releaseHeld(state, rendered.last);
  }
  if (state.heldStopped) state.stopped = true;
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
    const limit = start + GREP_LIMITS.passageLines - 1;
    let cut = index;
    while (cut + 1 < open.matches.length && open.matches[cut + 1] <= limit)
      cut += 1;
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
  let cut = 0;
  while (cut + 1 < open.matches.length && open.matches[cut + 1] <= limit)
    cut += 1;
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
  const resume = state.resume;
  const pending = state.show.kind === "pending";
  // A resumed page shows the tail of the passage that holds its cursor, so
  // that interval holds from the line after the cursor's cut; a passage after
  // the cursor's start is shown whole and holds from its own start.
  const resumeStart = resume === undefined ? 0 : resume.startLine;
  const showLine =
    resume === undefined || resume.endLine === undefined
      ? resumeStart + 1
      : Math.max(resumeStart + 1, resume.endLine + 1);
  state.open = {
    start,
    end: line + GREP_LIMITS.contextLines,
    matches: [line],
    passageStart: start,
    holdStart: pending && start <= resumeStart ? showLine : start,
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
  if (state.kind === "show") return { kind: "whole" };
  if (state.kind === "stop" || resume === undefined)
    return { kind: "drop", next: { kind: "stop" } };
  const next: ShowState =
    resume.truncated === true ? { kind: "stop" } : { kind: "show" };
  if (start <= resume.startLine && resume.startLine <= end) {
    return resume.endLine !== undefined && resume.endLine < end
      ? { kind: "tail", from: resume.endLine + 1, next }
      : { kind: "drop", next };
  }
  if (start > resume.startLine) return { kind: "whole" };
  return { kind: "drop", next: state };
}
