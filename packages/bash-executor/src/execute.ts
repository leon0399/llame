import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  BashAttemptReceipt,
  BashCommandInput,
  BashExecutorContext,
  BashKnownResult,
  BashResult,
  BashUnavailableResult,
} from "./types";
import { managedChildPath } from "./env";
import {
  requireManagedBoundary,
  safeCommandMetadata,
  sanitizeKnownResult,
} from "./sanitize";
import { sharedWorkingDirectory } from "./workspace";
import { resolveConfiguredTool } from "./tools";

/** Advertised executor class. Direct host bash is never named here. */
export const MANAGED_EXECUTOR = "managed" as const;

let activeProcesses = 0;

export type ExecuteManagedBashOptions = {
  readonly signal?: AbortSignal;
  readonly protectedValues?: ReadonlyArray<string>;
};

type RunRequest = {
  readonly tool: string;
  readonly args: ReadonlyArray<string>;
  readonly context: BashExecutorContext;
  readonly cwd: string;
  readonly attempt: BashAttemptReceipt;
  readonly options: ExecuteManagedBashOptions;
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

export function createAttemptReceipt(
  input: BashCommandInput,
): BashAttemptReceipt {
  const attemptId = randomUUID();
  const meta = safeCommandMetadata(attemptId, input);
  return {
    attemptId,
    recordedAt: new Date().toISOString(),
    commandDigest: meta.commandDigest,
  };
}

function measureInput(input: BashCommandInput): number {
  const args = input.args ?? [];
  return (
    input.command.length + args.reduce((sum, arg) => sum + arg.length + 1, 0)
  );
}

function isBashUnavailable(
  value: string | BashUnavailableResult,
): value is BashUnavailableResult {
  return typeof value !== "string";
}

function rejectIfNotAdmitted(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): BashUnavailableResult | null {
  const boundary = requireManagedBoundary(context);
  if (boundary) return boundary;

  const tool = resolveConfiguredTool(input.command);
  if (tool === null) {
    return {
      status: "error",
      type: "unavailable",
      message: "Command is outside the configured managed tool set.",
    };
  }
  if (measureInput(input) > context.inputBound) {
    return {
      status: "error",
      type: "unavailable",
      message: "Command input exceeds the managed input bound.",
    };
  }
  if (activeProcesses >= context.maxProcesses) {
    return {
      status: "error",
      type: "unavailable",
      message: "Managed process limit reached.",
    };
  }
  if (options.signal?.aborted) {
    return {
      status: "error",
      type: "cancelled",
      message: "Command was cancelled before start.",
    };
  }
  return null;
}

function admitExecution(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): RunRequest | BashUnavailableResult {
  const rejected = rejectIfNotAdmitted(input, context, options);
  if (rejected) return rejected;

  const cwdResult = sharedWorkingDirectory(context);
  if (isBashUnavailable(cwdResult)) return cwdResult;

  const tool = resolveConfiguredTool(input.command);
  if (tool === null) {
    return {
      status: "error",
      type: "unavailable",
      message: "Command is outside the configured managed tool set.",
    };
  }

  return {
    tool,
    args: input.args ?? [],
    context,
    cwd: cwdResult,
    attempt: createAttemptReceipt(input),
    options,
  };
}

/**
 * Bounded managed bash. Requires an explicit boundary; never advertises direct
 * host execution. Caller must only use this against a disposable workspace.
 */
export async function executeManagedBash(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions = {},
): Promise<BashResult> {
  const admitted = admitExecution(input, context, options);
  if ("type" in admitted) return admitted;
  return runAdmitted(admitted);
}

async function runAdmitted(request: RunRequest): Promise<BashResult> {
  activeProcesses += 1;
  try {
    return await spawnManaged(request);
  } finally {
    activeProcesses -= 1;
  }
}

function spawnManaged(request: RunRequest): Promise<BashResult> {
  return new Promise((resolve) => {
    const child = spawn(request.tool, [...request.args], {
      cwd: request.cwd,
      env: { PATH: managedChildPath(), LANG: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    watchChild(child, request, resolve);
  });
}

type WatchControls = {
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
};

function emptyStreams(): StreamState {
  return {
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function newControls(): WatchControls {
  return {};
}

function watchChild(
  child: ChildProcess,
  request: RunRequest,
  resolve: (result: BashResult) => void,
): void {
  const streams = emptyStreams();
  const controls = newControls();
  const finish = once(resolve, () => clearWatch(request, controls));
  wireCancellation(child, request, controls, finish);
  armTimeout(child, request, controls, finish);
  attachStreamReaders(child, request.context.outputBound, streams);
  wireExit(child, request, streams, finish);
}

function clearWatch(request: RunRequest, controls: WatchControls): void {
  if (controls.timer !== undefined) clearTimeout(controls.timer);
  if (controls.onAbort) {
    request.options.signal?.removeEventListener("abort", controls.onAbort);
  }
}

function wireCancellation(
  child: ChildProcess,
  request: RunRequest,
  controls: WatchControls,
  finish: (result: BashResult) => void,
): void {
  controls.onAbort = () => {
    child.kill("SIGKILL");
    finish({
      status: "error",
      type: "cancelled",
      message: "Command was cancelled.",
    });
  };
  request.options.signal?.addEventListener("abort", controls.onAbort, {
    once: true,
  });
}

function armTimeout(
  child: ChildProcess,
  request: RunRequest,
  controls: WatchControls,
  finish: (result: BashResult) => void,
): void {
  controls.timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish({
      status: "error",
      type: "outcome_unknown",
      attemptId: request.attempt.attemptId,
      message: "Command outcome could not be established; it was not replayed.",
    });
  }, request.context.durationMs);
}

function wireExit(
  child: ChildProcess,
  request: RunRequest,
  streams: StreamState,
  finish: (result: BashResult) => void,
): void {
  child.on("error", () => {
    finish({
      status: "error",
      type: "unavailable",
      message: "Configured tool could not be started.",
    });
  });
  child.on("close", (code, signal) => {
    finish(closeResult(code, signal, request, streams));
  });
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

function attachStreamReaders(
  child: ChildProcess,
  bound: number,
  streams: StreamState,
): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    const next = appendBound(streams.stdout, chunk, bound);
    streams.stdout = next.text;
    streams.stdoutTruncated ||= next.truncated;
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const next = appendBound(streams.stderr, chunk, bound);
    streams.stderr = next.text;
    streams.stderrTruncated ||= next.truncated;
  });
}

function appendBound(
  current: string,
  chunk: Buffer,
  bound: number,
): BoundChunk {
  if (current.length >= bound) return { text: current, truncated: true };
  const merged = current + chunk.toString("utf8");
  if (merged.length <= bound) return { text: merged, truncated: false };
  return { text: merged.slice(0, bound), truncated: true };
}

function closeResult(
  code: number | null,
  signal: NodeJS.Signals | null,
  request: RunRequest,
  streams: StreamState,
): BashResult {
  if (signal !== null && request.options.signal?.aborted) {
    return {
      status: "error",
      type: "cancelled",
      message: "Command was cancelled.",
    };
  }
  const exitCode = code ?? 1;
  const raw: BashKnownResult = {
    status: exitCode === 0 ? "success" : "error",
    operation: "bash",
    executor: MANAGED_EXECUTOR,
    exitCode,
    stdout: streams.stdout,
    stderr: streams.stderr,
    truncated: streams.stdoutTruncated || streams.stderrTruncated,
  };
  return sanitizeKnownResult(
    raw,
    request.context,
    request.options.protectedValues ?? [],
  );
}
