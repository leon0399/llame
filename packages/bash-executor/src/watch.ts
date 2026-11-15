import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import type {
  BashResult,
  ManagedBashHandle,
  ManagedOutput,
  ManagedStopCause,
  ManagedStopResult,
} from "./types";
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
import {
  emptySnapshotCaches,
  snapshotOutput,
  type SnapshotCache,
} from "./snapshot-cache";
import type { BashExecutorContext, BashKnownResult } from "./types";
import {
  subscribeOutput,
  captureWithActivity,
  deferred,
  NO_OUTPUT,
  outputOf,
} from "./managed-output";

const OUTPUT_DRAIN_BUDGET_MS = 50;

export type WatchRequest = {
  readonly context: BashExecutorContext;
  readonly attemptId: string;
  /** Whether the caller supplies a per-call deadline or a command lifetime. */
  readonly deadline: boolean;
  readonly options: {
    readonly signal?: AbortSignal;
    readonly timeoutSignal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly lifetimeMs?: number;
    readonly protectedValues?: ReadonlyArray<string>;
  };
};

type CapturedStream = {
  text: string;
  /** One decoder per pipe: a character split across chunks decodes once. */
  readonly decoder: StringDecoder;
  /** The stream's own measure against its bound, updated per chunk. */
  used: number;
  /** True once output was discarded: the capture limit or a drain stopped it. */
  lost: boolean;
};

type StreamState = {
  readonly stdout: CapturedStream;
  readonly stderr: CapturedStream;
};

type CapturedChunk = {
  readonly text: string;
  readonly used: number;
  readonly overflow: boolean;
};

type WatchControls = {
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
  onTimeout?: () => void;
  settling: boolean;
};

type WatchSession = {
  readonly snapshots: { stdout: SnapshotCache; stderr: SnapshotCache };
  readonly child: ChildProcess;
  readonly pgid: number;
  readonly request: WatchRequest;
  /** The moment the watcher took the spawned child: the wall time's origin. */
  readonly startedAtMs: number;
  readonly streams: StreamState;
  readonly controls: WatchControls;
  readonly finish: (result: BashResult) => void;
  readonly outputListeners: Set<(bytes: number) => void>;
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

/** One captured stream: its text, its decoder, and its measure so far. */
function emptyStream(): CapturedStream {
  return {
    text: "",
    decoder: new StringDecoder("utf8"),
    used: 0,
    lost: false,
  };
}

/** What a caller of the watcher can do while the child runs. */
export type ManagedWatch = Omit<ManagedBashHandle, "pid">;

export function watchManagedChild(
  child: ChildProcess,
  request: WatchRequest,
  resolve: (result: BashResult) => void = () => undefined,
): ManagedWatch {
  const controls: WatchControls = { settling: false };
  const { promise: settled, resolve: resolveSettled } = deferred<BashResult>();
  let settledOutput: ManagedOutput | undefined;

  const finish = once(
    (result) => {
      if ("stdout" in result) settledOutput = outputOf(result);
      resolve(result);
      resolveSettled(result);
    },
    () => clearWatch(request, controls),
  );

  const pgid = child.pid;

  if (pgid === undefined) return unstartedWatch(child, finish, settled);

  const session: WatchSession = {
    child,
    pgid,
    request,
    startedAtMs: performance.now(),
    streams: { stdout: emptyStream(), stderr: emptyStream() },
    snapshots: emptySnapshotCaches(),
    controls,
    finish,
    outputListeners: new Set(),
  };

  armAbort(session);

  if (request.deadline) armDeadline(session);
  attachStreams(session);
  armExit(session);

  return {
    settled,
    snapshot: () => settledOutput ?? snapshotOutput(session),
    onOutput: (listener) => subscribeOutput(session.outputListeners, listener),
    stop: (cause) => stopSession(session, cause, settled),
  };
}

/** A child with no pid never started: it settles as unavailable at once. */
function unstartedWatch(
  child: ChildProcess,
  finish: (result: BashResult) => void,
  settled: Promise<BashResult>,
): ManagedWatch {
  child.once("error", () => {});
  finish({
    status: "error",
    type: "unavailable",
    message: "Configured tool could not be started.",
  });

  return {
    settled,
    snapshot: () => NO_OUTPUT,
    onOutput: () => () => undefined,
    stop: () => Promise.resolve({ proved: true, ...NO_OUTPUT }),
  };
}

/**
 * The deadline's settle path for a caller that owns the deadline: kill the
 * group, prove it empty, drain for the budget, and return the streams. A stop
 * that finds the command already settling waits for that settlement.
 */
async function stopSession(
  session: WatchSession,
  cause: ManagedStopCause,
  done: Promise<BashResult>,
): Promise<ManagedStopResult> {
  if (session.controls.settling) {
    const result = await done;
    const proved = !("type" in result && result.type === "outcome_unknown");

    return {
      proved,
      ...outputOf(
        "stdout" in result ? result : knownCloseResult(1, session, true),
      ),
    };
  }

  session.controls.settling = true;

  if (!(await stopProcessGroup(session.pgid))) {
    session.finish(completeAttemptUnknown(session.request.attemptId));

    return {
      proved: false,
      ...outputOf(knownCloseResult(1, session, true)),
    };
  }

  await drainOutput(session);
  const output = outputOf(knownCloseResult(1, session, true));
  session.finish({
    status: "error",
    type: "cancelled",
    message: `Command was stopped (${cause}).`,
  });

  return { proved: true, ...output };
}

function clearWatch(
  request: WatchRequest,
  controls: WatchSession["controls"],
): void {
  const { signal, timeoutSignal } = request.options;
  const { timer, onAbort, onTimeout } = controls;
  clearTimeout(timer);

  if (onAbort) signal?.removeEventListener("abort", onAbort);

  if (onTimeout) timeoutSignal?.removeEventListener("abort", onTimeout);
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
  const onTimeout = () => void settleDeadline(session);
  session.controls.onTimeout = onTimeout;
  timeoutSignal?.addEventListener("abort", onTimeout, { once: true });

  const durationMs = effectiveDeadlineMs(session);
  const deadlineAt = session.startedAtMs + durationMs;

  const arm = (remaining: number) => {
    session.controls.timer = setTimeout(
      remaining > 2_147_483_647
        ? () => arm(deadlineAt - performance.now())
        : onTimeout,
      Math.max(0, Math.min(remaining, 2_147_483_647)),
    );
  };

  arm(durationMs);

  if (timeoutSignal?.aborted) onTimeout();
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
  const output = knownCloseResult(1, session, true);
  session.finish({
    status: "error",
    type: "timed_out",
    durationMs: effectiveDeadlineMs(session),
    ...(output.wallTimeMs !== undefined && {
      wallTimeMs: output.wallTimeMs,
    }),
    ...outputOf(output),
  });
}

function effectiveDeadlineMs(session: WatchSession): number {
  const { context, options } = session.request;

  return (
    options.lifetimeMs ??
    Math.min(context.durationMs, options.timeoutMs ?? context.durationMs)
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
 * A decoder still holding bytes holds an incomplete trailing UTF-8 sequence.
 * Discarding it instead of flushing its replacement character keeps a partial
 * member from being hidden behind U+FFFD; the stream lost output, so it is
 * marked truncated.
 */
function flushDecoders(session: WatchSession): void {
  discardIncomplete(session.streams.stdout);
  discardIncomplete(session.streams.stderr);
}

function discardIncomplete(stream: CapturedStream): void {
  if (stream.decoder.end() !== "") stream.lost = true;
}

function markOutputTruncated(session: WatchSession, stream: Readable): void {
  if (stream === session.child.stdout) {
    session.streams.stdout.lost = true;
  } else if (stream === session.child.stderr) {
    session.streams.stderr.lost = true;
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

  const result = knownCloseResult(code, session, false);
  session.finish(signal === null ? result : { ...result, signal });
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
  const capture = withLookahead(
    streamOutputBound(session.request.context),
    session.request.options.protectedValues ?? [],
  );

  const receive = (stream: CapturedStream) =>
    captureWithActivity(session.outputListeners, stream, (chunk) =>
      onStreamData(stream, chunk, capture),
    );

  session.child.stdout?.on("data", receive(session.streams.stdout));
  session.child.stderr?.on("data", receive(session.streams.stderr));
}

function onStreamData(
  stream: CapturedStream,
  chunk: Buffer,
  capture: StreamBound,
): void {
  // Decoding a chunk a full capture will discard buys nothing.
  if (stream.used >= capture.limit) {
    stream.lost = true;

    return;
  }

  appendDecoded(stream, stream.decoder.write(chunk), capture);
}

function appendDecoded(
  stream: CapturedStream,
  text: string,
  capture: StreamBound,
): void {
  const next = appendCapture(stream.text, stream.used, text, capture);
  stream.text = next.text;
  stream.used = next.used;
  stream.lost ||= next.overflow;
}

/**
 * The capture limit: the bound plus a lookahead of the longest protected
 * value in the bound's unit, so a member starting before the bound is captured
 * whole. The lookahead is bounded by the configured set, never by output.
 */
function withLookahead(
  bound: StreamBound,
  protectedValues: ReadonlyArray<string>,
): StreamBound {
  let longest = 0;

  for (const protectedValue of protectedValues) {
    longest = Math.max(longest, boundedLength(protectedValue, bound));
  }

  return { kind: bound.kind, limit: bound.limit + longest };
}

/**
 * Append one chunk under the capture limit. A capture already at its limit
 * keeps nothing more; a chunk that crosses it is cut on a code-point boundary,
 * and the capture is then marked full even when the cut lands short of the
 * limit, so no later chunk can reopen it.
 */
function appendCapture(
  current: string,
  used: number,
  text: string,
  capture: StreamBound,
): CapturedChunk {
  const size = boundedLength(text, capture);

  if (used + size <= capture.limit) {
    return {
      text: current + text,
      used: used + size,
      overflow: false,
    };
  }

  const remainder: StreamBound = {
    kind: capture.kind,
    limit: capture.limit - used,
  };

  return {
    text: current + cutToBound(text, remainder),
    used: capture.limit,
    overflow: true,
  };
}

function knownCloseResult(
  code: number | null,
  session: WatchSession,
  endedByLlame: boolean,
): BashKnownResult {
  const context = session.request.context;
  const bound = streamOutputBound(context);
  const streams = session.streams;

  const stdoutTruncated =
    streams.stdout.lost || streams.stdout.used > bound.limit;

  const stderrTruncated =
    streams.stderr.lost || streams.stderr.used > bound.limit;

  const exitCode = code ?? 1;

  const raw: BashKnownResult = {
    status: exitCode === 0 ? "success" : "error",
    exitCode,
    stdout: streams.stdout.text,
    stderr: streams.stderr.text,
    truncated: stdoutTruncated || stderrTruncated,
    truncatedStreams: { stdout: stdoutTruncated, stderr: stderrTruncated },
    wallTimeMs: Math.round(performance.now() - session.startedAtMs),
  };

  return sanitizeKnownResult(
    raw,
    context,
    session.request.options.protectedValues ?? [],
    {
      stdout: { endedByLlame: endedByLlame || streams.stdout.lost },
      stderr: { endedByLlame: endedByLlame || streams.stderr.lost },
    },
  );
}
