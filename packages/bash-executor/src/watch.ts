import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import type { BashResult } from "./types";
import { completeAttemptUnknown } from "./attempt-ledger";
import {
  stopProcessGroup,
  waitForProcessGroupQuiescence,
} from "./process-tree";
import {
  boundedLength,
  cutToBound,
  streamOutputBound,
  type StreamBound,
} from "./output-bound";
import { sanitizeKnownResult } from "./sanitize";
import type { BashExecutorContext, BashKnownResult } from "./types";

const OUTPUT_DRAIN_BUDGET_MS = 50;

export type WatchRequest = {
  readonly context: BashExecutorContext;
  readonly attemptId: string;
  readonly options: {
    readonly signal?: AbortSignal;
    readonly timeoutSignal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly protectedValues?: ReadonlyArray<string>;
  };
};

type StreamState = {
  stdout: string;
  stderr: string;
  /** One decoder per pipe: a character split across chunks decodes once. */
  readonly stdoutDecoder: StringDecoder;
  readonly stderrDecoder: StringDecoder;
  /** Each stream's own measure against its bound, updated per chunk. */
  stdoutUsed: number;
  stderrUsed: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

type BoundChunk = {
  readonly text: string;
  readonly used: number;
  readonly truncated: boolean;
};

type WatchControls = {
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
  onTimeout?: () => void;
  settling: boolean;
};

type WatchSession = {
  readonly child: ChildProcess;
  readonly pgid: number;
  readonly request: WatchRequest;
  /** The moment the watcher took the spawned child: the wall time's origin. */
  readonly startedAtMs: number;
  readonly streams: StreamState;
  readonly controls: WatchControls;
  readonly finish: (result: BashResult) => void;
};

type OutputDrainState = {
  readonly session: WatchSession;
  readonly streams: ReadonlyArray<Readable>;
  readonly pending: Set<Readable>;
  readonly listeners: Map<Readable, () => void>;
  readonly resolve: () => void;
  timer?: NodeJS.Timeout;
  settled: boolean;
};

/** One call's streams, each with its own decoder and its measure used so far. */
function emptyStreams(): StreamState {
  return {
    stdout: "",
    stderr: "",
    stdoutDecoder: new StringDecoder("utf8"),
    stderrDecoder: new StringDecoder("utf8"),
    stdoutUsed: 0,
    stderrUsed: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

export function watchManagedChild(
  child: ChildProcess,
  request: WatchRequest,
  resolve: (result: BashResult) => void,
): void {
  const controls: WatchControls = { settling: false };
  const streams = emptyStreams();
  const finish = once(resolve, () => clearWatch(request, controls));
  const pgid = child.pid;
  if (pgid === undefined) {
    child.once("error", () => {});
    finish({
      status: "error",
      type: "unavailable",
      message: "Configured tool could not be started.",
    });
    return;
  }
  const session: WatchSession = {
    child,
    pgid,
    request,
    startedAtMs: performance.now(),
    streams,
    controls,
    finish,
  };
  armAbort(session);
  armDeadline(session);
  attachStreams(session);
  armExit(session);
}

function clearWatch(
  request: WatchRequest,
  controls: WatchSession["controls"],
): void {
  if (controls.timer !== undefined) clearTimeout(controls.timer);
  if (controls.onAbort) {
    request.options.signal?.removeEventListener("abort", controls.onAbort);
  }
  if (controls.onTimeout) {
    request.options.timeoutSignal?.removeEventListener(
      "abort",
      controls.onTimeout,
    );
  }
}

function armAbort(session: WatchSession): void {
  session.controls.onAbort = () => {
    // AbortSignal.any propagates the timeout source to the composed signal
    // synchronously. Check the source here so timeout remains distinguishable
    // from caller cancellation regardless of listener ordering.
    if (session.request.options.timeoutSignal?.aborted) {
      void settleDeadline(session);
      return;
    }
    void settleAbort(session);
  };
  session.request.options.signal?.addEventListener(
    "abort",
    session.controls.onAbort,
    { once: true },
  );
}

async function settleAbort(session: WatchSession): Promise<void> {
  if (session.controls.settling) return;
  session.controls.settling = true;
  const stopped = await stopProcessGroup(session.pgid);
  if (stopped) {
    session.finish({
      status: "error",
      type: "cancelled",
      message: "Command was cancelled.",
    });
    return;
  }
  session.finish(completeAttemptUnknown(session.request.attemptId));
}

function armDeadline(session: WatchSession): void {
  const timeoutSignal = session.request.options.timeoutSignal;
  if (timeoutSignal !== undefined) {
    session.controls.onTimeout = () => {
      void settleDeadline(session);
    };
    timeoutSignal.addEventListener("abort", session.controls.onTimeout, {
      once: true,
    });
  }
  session.controls.timer = setTimeout(() => {
    void settleDeadline(session);
  }, effectiveDeadlineMs(session));
  if (timeoutSignal?.aborted) session.controls.onTimeout?.();
}

async function settleDeadline(session: WatchSession): Promise<void> {
  if (session.controls.settling) return;
  session.controls.settling = true;
  const stopped = await stopProcessGroup(session.pgid);
  if (!stopped) {
    session.finish(completeAttemptUnknown(session.request.attemptId));
    return;
  }
  await drainOutput(session);
  const output = knownCloseResult(1, session);
  session.finish({
    status: "error",
    type: "timed_out",
    durationMs: effectiveDeadlineMs(session),
    ...(output.wallTimeMs !== undefined && {
      wallTimeMs: output.wallTimeMs,
    }),
    stdout: output.stdout,
    stderr: output.stderr,
    truncated: output.truncated,
  });
}

function effectiveDeadlineMs(session: WatchSession): number {
  return Math.min(
    session.request.context.durationMs,
    session.request.options.timeoutMs ?? session.request.context.durationMs,
  );
}

function drainOutput(session: WatchSession): Promise<void> {
  const streams = [session.child.stdout, session.child.stderr].filter(
    (stream): stream is Readable => stream !== null,
  );
  return new Promise<void>((resolve) => {
    const state: OutputDrainState = {
      session,
      streams,
      pending: new Set(),
      listeners: new Map(),
      resolve,
      settled: false,
    };
    streams.forEach((stream) => watchOutputStream(state, stream));
    if (state.pending.size === 0) {
      finishOutputDrain(state, false);
      return;
    }
    state.timer = setTimeout(
      () => finishOutputDrain(state, true),
      OUTPUT_DRAIN_BUDGET_MS,
    );
  });
}

function watchOutputStream(state: OutputDrainState, stream: Readable): void {
  if (stream.readableEnded || stream.destroyed) return;
  state.pending.add(stream);
  const listener = () => onOutputStreamClosed(state, stream);
  state.listeners.set(stream, listener);
  stream.once("close", listener);
  stream.once("end", listener);
  stream.once("error", listener);
}

function onOutputStreamClosed(state: OutputDrainState, stream: Readable): void {
  state.pending.delete(stream);
  if (state.pending.size === 0) finishOutputDrain(state, false);
}

function finishOutputDrain(state: OutputDrainState, timedOut: boolean): void {
  if (state.settled) return;
  state.settled = true;
  if (state.timer !== undefined) clearTimeout(state.timer);
  flushDecoders(state.session);
  for (const stream of state.streams) {
    const listener = state.listeners.get(stream);
    if (listener !== undefined) {
      stream.off("close", listener);
      stream.off("end", listener);
      stream.off("error", listener);
    }
    if (timedOut && state.pending.has(stream)) {
      markOutputTruncated(state.session, stream);
      stream.destroy();
    }
  }
  state.resolve();
}

/**
 * Emit the bytes each decoder still holds: a command that ends on an
 * incomplete UTF-8 sequence keeps that sequence's replacement text, and a
 * stream stopped mid-character still reports its output.
 */
function flushDecoders(session: WatchSession): void {
  const bound = streamOutputBound(session.request.context);
  const stdout = session.streams.stdoutDecoder.end();
  if (stdout !== "") {
    const next = appendBound(
      session.streams.stdout,
      session.streams.stdoutUsed,
      stdout,
      bound,
    );
    session.streams.stdout = next.text;
    session.streams.stdoutUsed = next.used;
    session.streams.stdoutTruncated ||= next.truncated;
  }
  const stderr = session.streams.stderrDecoder.end();
  if (stderr !== "") {
    const next = appendBound(
      session.streams.stderr,
      session.streams.stderrUsed,
      stderr,
      bound,
    );
    session.streams.stderr = next.text;
    session.streams.stderrUsed = next.used;
    session.streams.stderrTruncated ||= next.truncated;
  }
}

function markOutputTruncated(session: WatchSession, stream: Readable): void {
  if (stream === session.child.stdout) {
    session.streams.stdoutTruncated = true;
  } else if (stream === session.child.stderr) {
    session.streams.stderrTruncated = true;
  }
}

function armExit(session: WatchSession): void {
  session.child.on("error", () => {
    void settleChildError(session);
  });
  session.child.on("close", (code, signal) => {
    void settleExit(session, code, signal);
  });
}

async function settleChildError(session: WatchSession): Promise<void> {
  if (session.controls.settling) return;
  session.controls.settling = true;
  await stopProcessGroup(session.pgid);
  session.finish(completeAttemptUnknown(session.request.attemptId));
}

async function settleExit(
  session: WatchSession,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  if (session.controls.settling) return;
  session.controls.settling = true;

  if (signal !== null && session.request.options.signal?.aborted) {
    const stopped = await waitForProcessGroupQuiescence(session.pgid);
    if (stopped) {
      session.finish({
        status: "error",
        type: "cancelled",
        message: "Command was cancelled.",
      });
      return;
    }
    session.finish(completeAttemptUnknown(session.request.attemptId));
    return;
  }

  if (!(await waitForProcessGroupQuiescence(session.pgid, 50))) {
    const stopped = await stopProcessGroup(session.pgid);
    if (!stopped) {
      session.finish(completeAttemptUnknown(session.request.attemptId));
      return;
    }
  }

  session.finish(knownCloseResult(code, session));
}

function once(
  resolve: (result: BashResult) => void,
  cleanup: () => void,
): (result: BashResult) => void {
  let settled = false;
  return (result) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(result);
  };
}

function attachStreams(session: WatchSession): void {
  const bound = streamOutputBound(session.request.context);
  session.child.stdout?.on("data", (chunk: Buffer) => {
    // Decoding a chunk a full stream will discard buys nothing.
    if (session.streams.stdoutUsed >= bound.limit) {
      session.streams.stdoutTruncated = true;
      return;
    }
    const next = appendBound(
      session.streams.stdout,
      session.streams.stdoutUsed,
      session.streams.stdoutDecoder.write(chunk),
      bound,
    );
    session.streams.stdout = next.text;
    session.streams.stdoutUsed = next.used;
    session.streams.stdoutTruncated ||= next.truncated;
  });
  session.child.stderr?.on("data", (chunk: Buffer) => {
    if (session.streams.stderrUsed >= bound.limit) {
      session.streams.stderrTruncated = true;
      return;
    }
    const next = appendBound(
      session.streams.stderr,
      session.streams.stderrUsed,
      session.streams.stderrDecoder.write(chunk),
      bound,
    );
    session.streams.stderr = next.text;
    session.streams.stderrUsed = next.used;
    session.streams.stderrTruncated ||= next.truncated;
  });
}

/**
 * Append one chunk under the stream's bound. A stream already at its bound
 * keeps nothing more; a chunk that crosses it is cut on a code-point boundary,
 * and the stream is then marked full even when the cut lands short of the
 * bound, so no later chunk can reopen it.
 */
function appendBound(
  current: string,
  used: number,
  text: string,
  bound: StreamBound,
): BoundChunk {
  if (used >= bound.limit) {
    const truncated: BoundChunk = { text: current, used, truncated: true };
    return truncated;
  }
  const size = boundedLength(text, bound);
  if (used + size <= bound.limit) {
    const exact: BoundChunk = {
      text: current + text,
      used: used + size,
      truncated: false,
    };
    return exact;
  }
  const remainder: StreamBound = {
    kind: bound.kind,
    limit: bound.limit - used,
  };
  const clipped: BoundChunk = {
    text: current + cutToBound(text, remainder),
    used: bound.limit,
    truncated: true,
  };
  return clipped;
}

function knownCloseResult(
  code: number | null,
  session: WatchSession,
): BashKnownResult {
  const exitCode = code ?? 1;
  const raw: BashKnownResult = {
    status: exitCode === 0 ? "success" : "error",
    exitCode,
    stdout: session.streams.stdout,
    stderr: session.streams.stderr,
    truncated:
      session.streams.stdoutTruncated || session.streams.stderrTruncated,
    wallTimeMs: Math.round(performance.now() - session.startedAtMs),
  };
  return sanitizeKnownResult(
    raw,
    session.request.context,
    session.request.options.protectedValues ?? [],
  );
}
