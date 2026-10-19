import {
  BASH_BOUNDS,
  PROC_BASH_METHOD,
  type ProcBashResult,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  executeManagedBash,
  type BashCommandInput,
  type BashExecutorContext,
  type ExecuteManagedBashOptions,
} from "@workspace/bash-executor";
import { MachineRequestError } from "./errors";
import type { OperationContext } from "./dispatch-types";
import {
  optionalEnvironment,
  optionalString,
  paramRecord,
  requireString,
} from "./params";

const BASH = "bash";

/** The managed base environment plus the declared additions, as locally. */
function managedContext(cwd: string): BashExecutorContext {
  return {
    workingDirectory: cwd,
    secretBoundary: true,
    processIsolation: true,
    ...BASH_BOUNDS,
  };
}

/**
 * `cwd` is a Machine address like any other, so it is checked against the
 * roots; an omitted one runs in the first registered root.
 */
async function workingDirectory(
  context: OperationContext,
  requested: string | undefined,
): Promise<string> {
  const literal = requested ?? context.roots.at(0);
  if (literal === undefined)
    throw new MachineRequestError(
      "invalid_params",
      `${PROC_BASH_METHOD}: this Machine has no registered root to run in`,
    );
  const guarded = await context.guard.resolvePath(literal);
  // Checked here so the refusal never quotes the address back: the managed
  // executor's own message names the literal it was given.
  if (guarded.kind !== "directory")
    throw new MachineRequestError(
      "invalid_params",
      `${PROC_BASH_METHOD}: the working directory is not a directory`,
    );
  return guarded.path;
}

function runOptions(context: OperationContext): ExecuteManagedBashOptions {
  return context.toolCallId === undefined
    ? { signal: context.signal }
    : { signal: context.signal, toolCallId: context.toolCallId };
}

export async function bashOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<ProcBashResult> {
  const source = paramRecord(params, PROC_BASH_METHOD);
  const cwd = await workingDirectory(
    context,
    optionalString(source, "cwd", PROC_BASH_METHOD),
  );
  const input: BashCommandInput = {
    // Always wrap in bash -c: the managed allowlist admits the shell, not the
    // ordinary commands a model writes.
    command: BASH,
    args: ["-c", requireString(source, "command", PROC_BASH_METHOD)],
    cwd,
    env: optionalEnvironment(source, PROC_BASH_METHOD),
  };
  return context.processes.track(
    executeManagedBash(input, managedContext(cwd), runOptions(context)),
  );
}
