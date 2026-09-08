import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  BashCommandInput,
  BashExecutorContext,
  BashResult,
  BashUnavailableResult,
} from "./types";
import {
  rejectQuarantinedGroups,
  resetAttemptLedgerForTests,
} from "./attempt-ledger";
import { managedChildPath } from "./env";
import { MANAGED_EXECUTOR } from "./managed-constants";
import { requireManagedBoundary } from "./sanitize";
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
  readonly attemptId: string;
  readonly options: ExecuteManagedBashOptions;
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
): BashUnavailableResult | null {
  const boundary = requireManagedBoundary(context);
  if (boundary) return boundary;
  const quarantine = rejectQuarantinedGroups();
  if (quarantine) return quarantine;
  const limits = rejectLimits(input, context, options);
  if (limits) return limits;
  return null;
}

function admitExecution(
  input: BashCommandInput,
  context: BashExecutorContext,
  options: ExecuteManagedBashOptions,
): RunRequest | BashUnavailableResult {
  const cwdResult = sharedWorkingDirectory(context);
  if (isBashUnavailable(cwdResult)) return cwdResult;

  const rejected = rejectIfNotAdmitted(input, context, options);
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
): AdmittedBashExecution | BashUnavailableResult {
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

function spawnManaged(request: RunRequest): Promise<BashResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(request.tool, [...request.args], {
        cwd: request.cwd,
        env: { PATH: managedChildPath(), LANG: "C.UTF-8" },
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
