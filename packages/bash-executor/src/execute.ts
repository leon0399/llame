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
} from "./types";
import {
  rejectQuarantinedGroups,
  resetAttemptLedgerForTests,
} from "./attempt-ledger";
import { managedChildEnvironment, managedEnvironmentCollision } from "./env";
import { MANAGED_EXECUTOR } from "./managed-constants";
import { requireManagedBoundary } from "./sanitize";
import { resolveConfiguredTool } from "./tools";
import { watchManagedChild } from "./watch";

export { MANAGED_EXECUTOR };

let activeProcesses = 0;

export type ExecuteManagedBashOptions = {
  readonly signal?: AbortSignal;
  /** Trusted per-call deadline signal, distinct from caller cancellation. */
  readonly timeoutSignal?: AbortSignal;
  /** Effective per-call deadline in milliseconds. */
  readonly timeoutMs?: number;
  readonly protectedValues?: ReadonlyArray<string>;
  /** Opaque model tool-call identity; never invents a replay. */
  readonly toolCallId?: string;
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

export function resetManagedExecutorForTests(): void {
  activeProcesses = 0;
  resetAttemptLedgerForTests();
}

function measureInput(input: BashCommandInput): number {
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

function unusableWorkingDirectory(literal: string): BashUnavailableResult {
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
  const quarantine = rejectQuarantinedGroups();
  if (quarantine) return quarantine;
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
  return admitted.run();
}

export type AdmittedBashExecution = {
  readonly cwd: string;
  readonly run: () => Promise<BashResult>;
  readonly release: () => void;
};

/** Reserve a process slot before the caller commits its durable attempt. */
export function admitManagedBash(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions = {},
): AdmittedBashExecution | BashUnavailableResult | BashTimedOutResult {
  const request = admitExecution(input, context, options);
  if ("type" in request) return request;
  activeProcesses += 1;
  let reserved = true;
  return {
    cwd: request.cwd,
    release: () => {
      if (!reserved) return;
      reserved = false;
      activeProcesses -= 1;
    },
    run: async () => {
      if (!reserved)
        return {
          status: "error",
          type: "unavailable",
          message: "Command admission has already been consumed or released.",
        };
      reserved = false;
      return runAdmitted(request);
    },
  };
}

async function runAdmitted(request: RunRequest): Promise<BashResult> {
  try {
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
    return await spawnManaged(request);
  } finally {
    activeProcesses -= 1;
  }
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

function spawnManaged(request: RunRequest): Promise<BashResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(request.tool, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: true,
      });
    } catch {
      resolve({
        status: "error",
        type: "unavailable",
        message: "Configured tool could not be started.",
      });
      return;
    }
    watchManagedChild(
      child,
      {
        context: request.context,
        attemptId: request.attemptId,
        options: request.options,
      },
      resolve,
    );
  });
}
