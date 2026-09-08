import type { ChildProcess } from "node:child_process";
import type { BashResult } from "./types";
import { completeAttemptUnknown } from "./attempt-ledger";
import {
  stopProcessGroup,
  waitForProcessGroupQuiescence,
} from "./process-tree";
import { sanitizeKnownResult } from "./sanitize";
import type { BashExecutorContext, BashKnownResult } from "./types";
import { MANAGED_EXECUTOR } from "./managed-constants";

export type WatchRequest = {
  readonly context: BashExecutorContext;
  readonly attemptId: string;
  readonly options: {
    readonly signal?: AbortSignal;
    readonly protectedValues?: ReadonlyArray<string>;
  };
};

type StreamState = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

type BoundChunk = {
  readonly text: string;
  readonly truncated: boolean;
};

type WatchControls = {
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
  settling: boolean;
};

type WatchSession = {
  readonly child: ChildProcess;
  readonly pgid: number;
  readonly request: WatchRequest;
  readonly streams: StreamState;
  readonly controls: WatchControls;
  readonly finish: (result: BashResult) => void;
};

export function watchManagedChild(
  child: ChildProcess,
  request: WatchRequest,
  resolve: (result: BashResult) => void,
): void {
  const controls: WatchControls = { settling: false };
  const streams: StreamState = {
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
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
}

function armAbort(session: WatchSession): void {
  session.controls.onAbort = () => {
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
  session.finish(
    completeAttemptUnknown(session.request.attemptId, session.pgid),
  );
}

function armDeadline(session: WatchSession): void {
  session.controls.timer = setTimeout(() => {
    void settleDeadline(session);
  }, session.request.context.durationMs);
}

async function settleDeadline(session: WatchSession): Promise<void> {
  if (session.controls.settling) return;
  session.controls.settling = true;
  const stopped = await stopProcessGroup(session.pgid);
  if (!stopped) {
    session.finish(
      completeAttemptUnknown(session.request.attemptId, session.pgid),
    );
    return;
  }
  const output = knownCloseResult(1, session);
  session.finish({
    status: "error",
    type: "timed_out",
    durationMs: session.request.context.durationMs,
    stdout: output.stdout,
    stderr: output.stderr,
    truncated: output.truncated,
  });
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
  session.finish(
    completeAttemptUnknown(session.request.attemptId, session.pgid),
  );
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
    session.finish(
      completeAttemptUnknown(session.request.attemptId, session.pgid),
    );
    return;
  }

  const survivors = !(await waitForProcessGroupQuiescence(session.pgid, 50));
  if (survivors) {
    await stopProcessGroup(session.pgid);
    session.finish(
      completeAttemptUnknown(session.request.attemptId, session.pgid),
    );
    return;
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
  const bound = session.request.context.outputBound;
  session.child.stdout?.on("data", (chunk: Buffer) => {
    const next = appendBound(session.streams.stdout, chunk, bound);
    session.streams.stdout = next.text;
    session.streams.stdoutTruncated ||= next.truncated;
  });
  session.child.stderr?.on("data", (chunk: Buffer) => {
    const next = appendBound(session.streams.stderr, chunk, bound);
    session.streams.stderr = next.text;
    session.streams.stderrTruncated ||= next.truncated;
  });
}

function appendBound(
  current: string,
  chunk: Buffer,
  bound: number,
): BoundChunk {
  if (current.length >= bound) {
    const truncated: BoundChunk = { text: current, truncated: true };
    return truncated;
  }
  const merged = current + chunk.toString("utf8");
  if (merged.length <= bound) {
    const exact: BoundChunk = { text: merged, truncated: false };
    return exact;
  }
  const clipped: BoundChunk = {
    text: merged.slice(0, bound),
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
    operation: "bash",
    executor: MANAGED_EXECUTOR,
    exitCode,
    stdout: session.streams.stdout,
    stderr: session.streams.stderr,
    truncated:
      session.streams.stdoutTruncated || session.streams.stderrTruncated,
  };
  return sanitizeKnownResult(
    raw,
    session.request.context,
    session.request.options.protectedValues ?? [],
  );
}
