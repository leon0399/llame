import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  BashAttemptReceipt,
  BashCommandInput,
  BashExecutorContext,
  BashResult,
  BashUnavailableResult,
} from "./types";
import {
  clearFence,
  getAttempt,
  isDirectoryFenced,
  recordAttemptStart,
  recoverIncompleteAttempts,
  refusesUnknownReplay,
  releaseUnknownCommands,
  resetAttemptLedgerForTests,
} from "./attempt-ledger";
import { managedChildPath } from "./env";
import { MANAGED_EXECUTOR } from "./managed-constants";
import { requireManagedBoundary, safeCommandMetadata } from "./sanitize";
import { sharedWorkingDirectory } from "./workspace";
import { resolveConfiguredTool } from "./tools";
import { watchManagedChild } from "./watch";

export { MANAGED_EXECUTOR };

let activeProcesses = 0;

export type ExecuteManagedBashOptions = {
  readonly signal?: AbortSignal;
  readonly protectedValues?: ReadonlyArray<string>;
  /** Opaque model tool-call identity; never invents a replay. */
  readonly toolCallId?: string;
};

type RunRequest = {
  readonly tool: string;
  readonly args: ReadonlyArray<string>;
  readonly context: BashExecutorContext;
  readonly cwd: string;
  readonly attempt: BashAttemptReceipt;
  readonly options: ExecuteManagedBashOptions;
  readonly toolCallId: string | null;
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

export {
  clearFence,
  getAttempt,
  recoverIncompleteAttempts,
  releaseUnknownCommands,
  refusesUnknownReplay,
  resetAttemptLedgerForTests,
};

export function resetManagedExecutorForTests(): void {
  activeProcesses = 0;
  resetAttemptLedgerForTests();
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

function rejectLimits(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): BashUnavailableResult | null {
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

function rejectIfNotAdmitted(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
  cwd: string,
): BashUnavailableResult | null {
  const boundary = requireManagedBoundary(context);
  if (boundary) return boundary;
  if (isDirectoryFenced(cwd)) {
    return {
      status: "error",
      type: "unavailable",
      message: "Executor context is fenced after an unknown command outcome.",
    };
  }
  const limits = rejectLimits(input, context, options);
  if (limits) return limits;
  const digest = safeCommandMetadata("probe", input).commandDigest;
  if (refusesUnknownReplay(digest)) {
    return {
      status: "error",
      type: "unavailable",
      message:
        "Unknown command outcomes are not replayed under a new tool-call ID.",
    };
  }
  return null;
}

function admitExecution(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): RunRequest | BashUnavailableResult {
  const cwdResult = sharedWorkingDirectory(context);
  if (isBashUnavailable(cwdResult)) return cwdResult;

  const rejected = rejectIfNotAdmitted(input, context, options, cwdResult);
  if (rejected) return rejected;

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
    toolCallId: options.toolCallId ?? null,
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
  recordAttemptStart(request.attempt, request.cwd, request.toolCallId);
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
      detached: true,
    });
    watchManagedChild(
      child,
      {
        context: request.context,
        attemptId: request.attempt.attemptId,
        options: request.options,
      },
      resolve,
    );
  });
}
