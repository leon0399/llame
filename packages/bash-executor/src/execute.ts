import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, opendirSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BashCommandInput,
  BashExecutorContext,
  BashResult,
  BashTimedOutResult,
  BashUnavailableResult,
  ManagedBashHandle,
} from "./types";
import { BashProcessLimiter } from "./limiter";
import { managedChildEnvironment, managedEnvironmentCollision } from "./env";
import { requireManagedBoundary } from "./sanitize";
import { resolveConfiguredTool } from "./tools";
import { watchManagedChild } from "./watch";

export type ExecuteManagedBashOptions = {
  readonly signal?: AbortSignal;
  /** Trusted per-call deadline signal, distinct from caller cancellation. */
  readonly timeoutSignal?: AbortSignal;
  /** Effective per-call deadline in milliseconds. */
  readonly timeoutMs?: number;
  readonly protectedValues?: ReadonlyArray<string>;
  /** Opaque model tool-call identity; never invents a replay. */
  readonly toolCallId?: string;
  /** The limiter `executeManagedBash` takes its slot from; default: one per bound. */
  readonly limiter?: BashProcessLimiter;
};

type RunRequest = {
  readonly tool: string;
  readonly args: ReadonlyArray<string>;
  readonly context: BashExecutorContext;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly attemptId: string;
  readonly options: ExecuteManagedBashOptions;
};

/** One limiter per bound for `executeManagedBash` callers that pass none. */
const defaultLimiters = new Map<number, BashProcessLimiter>();

function defaultLimiter(maxProcesses: number): BashProcessLimiter {
  let limiter = defaultLimiters.get(maxProcesses);

  if (limiter === undefined) {
    limiter = new BashProcessLimiter(maxProcesses);
    defaultLimiters.set(maxProcesses, limiter);
  }

  return limiter;
}

function processLimitReached(): BashUnavailableResult {
  return {
    status: "error",
    type: "unavailable",
    message: "Managed process limit reached.",
  };
}

/** The input bound's measure: the command, its argv, the cwd, and the additions. */
export function measureManagedInput(input: BashCommandInput): number {
  const args = input.args ?? [];
  let size = Buffer.byteLength(input.command, "utf8");

  for (const arg of args) size += Buffer.byteLength(arg, "utf8") + 1;

  if (input.cwd !== undefined) size += Buffer.byteLength(input.cwd, "utf8") + 1;

  for (const [key, value] of Object.entries(input.env ?? {})) {
    size +=
      Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8") + 2;
  }

  return size;
}

/** The local refusal for a working directory the executor cannot enter. */
export function unusableWorkingDirectory(
  literal: string,
): BashUnavailableResult {
  return {
    status: "error",
    type: "unavailable",
    message: `Working directory argument ${JSON.stringify(literal)} is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.`,
  };
}

function resolveWorkingDirectory(
  input: BashCommandInput,
  context: BashExecutorContext,
): { readonly cwd: string } | BashUnavailableResult {
  const literal = input.cwd ?? ".";
  const cwd = resolve(context.workingDirectory, literal);

  try {
    accessSync(cwd, constants.X_OK);
    const directory = opendirSync(cwd);
    directory.closeSync();

    return { cwd };
  } catch {
    return unusableWorkingDirectory(literal);
  }
}

function rejectLimits(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): BashUnavailableResult | BashTimedOutResult | null {
  const tool = resolveConfiguredTool(input.command);

  if (tool === null) {
    return {
      status: "error",
      type: "unavailable",
      message: "Command is outside the configured managed tool set.",
    };
  }

  if (measureManagedInput(input) > context.inputBound) {
    return {
      status: "error",
      type: "unavailable",
      message: "Command input exceeds the managed input bound.",
    };
  }

  if (options.timeoutSignal?.aborted) {
    return timedOutResult(context, options);
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

function rejectIfNotAdmitted(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): BashUnavailableResult | BashTimedOutResult | null {
  const boundary = requireManagedBoundary(context);

  if (boundary) return boundary;
  const collision = managedEnvironmentCollision(input.env);

  if (collision !== undefined) {
    return {
      status: "error",
      type: "unavailable",
      message: `Environment variable ${collision} cannot replace a managed base variable.`,
    };
  }

  const limits = rejectLimits(input, context, options);

  if (limits) return limits;

  return null;
}

function admitExecution(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): RunRequest | BashUnavailableResult | BashTimedOutResult {
  const rejected = rejectIfNotAdmitted(input, context, options);

  if (rejected) return rejected;

  const cwdResult = resolveWorkingDirectory(input, context);

  if ("type" in cwdResult) return cwdResult;

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
    cwd: cwdResult.cwd,
    env: managedChildEnvironment(input.env),
    attemptId: options.toolCallId ?? randomUUID(),
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
  const admitted = admitManagedBash(input, context, options);

  if ("type" in admitted) return admitted;

  const slot = (
    options.limiter ?? defaultLimiter(context.maxProcesses)
  ).tryAcquire();

  if (slot === null) return processLimitReached();

  try {
    return await admitted.run();
  } finally {
    slot.release();
  }
}

export type AdmittedBashExecution = {
  readonly cwd: string;
  readonly run: () => Promise<BashResult>;
};

/**
 * Validate a command before the caller commits its durable attempt. It takes
 * no process slot: the caller holds one from its own limiter. Its `run` is single-use.
 */
export function admitManagedBash(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions = {},
): AdmittedBashExecution | BashUnavailableResult | BashTimedOutResult {
  const request = admitExecution(input, context, options);

  if ("type" in request) return request;

  let consumed = false;

  return {
    cwd: request.cwd,
    run: async () => {
      if (consumed)
        return {
          status: "error",
          type: "unavailable",
          message: "Command admission has already been consumed or released.",
        };
      consumed = true;

      return runAdmitted(request);
    },
  };
}

async function runAdmitted(request: RunRequest): Promise<BashResult> {
  if (request.options.timeoutSignal?.aborted) {
    return timedOutResult(request.context, request.options);
  }

  if (request.options.signal?.aborted) {
    return {
      status: "error",
      type: "cancelled",
      message: "Command was cancelled before start.",
    };
  }

  return spawnManaged(request);
}

function effectiveDeadlineMs(
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): number {
  return Math.min(context.durationMs, options.timeoutMs ?? context.durationMs);
}

function timedOutResult(
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): BashTimedOutResult {
  return {
    status: "error",
    type: "timed_out",
    durationMs: effectiveDeadlineMs(context, options),
    stdout: "",
    stderr: "",
    truncated: false,
  };
}

function spawnChild(request: RunRequest): ChildProcess | BashUnavailableResult {
  try {
    return spawn(request.tool, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
  } catch {
    return notStarted();
  }
}

function spawnManaged(request: RunRequest): Promise<BashResult> {
  const child = spawnChild(request);

  if ("status" in child) return Promise.resolve(child);

  return new Promise((resolve) => {
    watchManagedChild(
      child,
      {
        context: request.context,
        attemptId: request.attemptId,
        deadline: true,
        options: request.options,
      },
      resolve,
    );
  });
}

export type StartManagedBashOptions = Pick<
  ExecuteManagedBashOptions,
  "protectedValues" | "toolCallId"
>;

/**
 * Start a managed command and hand its control to the caller. The handle arms
 * no deadline and listens to no call signal: the caller stops the command
 * through `stop`, and takes its own process slot from a limiter.
 */
export function startManagedBash(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: StartManagedBashOptions = {},
): ManagedBashHandle | BashUnavailableResult | BashTimedOutResult {
  const request = admitExecution(input, context, {
    protectedValues: options.protectedValues,
    toolCallId: options.toolCallId,
  });

  if ("type" in request) return request;
  const child = spawnChild(request);

  if ("status" in child) return child;

  const watch = watchManagedChild(child, {
    context,
    attemptId: request.attemptId,
    deadline: false,
    options: request.options,
  });

  // A child that failed to spawn has no pid and has settled as unavailable.
  if (child.pid === undefined) return notStarted();

  return { pid: child.pid, ...watch };
}

function notStarted(): BashUnavailableResult {
  return {
    status: "error",
    type: "unavailable",
    message: "Configured tool could not be started.",
  };
}
