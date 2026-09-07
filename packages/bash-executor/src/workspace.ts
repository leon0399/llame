import { isAbsolute, resolve } from "node:path";
import type { BashExecutorContext, BashUnavailableResult } from "./types";

/**
 * Same-directory handoff with native file tools: both sides must resolve to
 * one absolute working directory before any adapter may claim success.
 */
export function assertSharedWorkingDirectory(
  context: BashExecutorContext,
): BashUnavailableResult | null {
  if (
    !isAbsolute(context.workingDirectory) ||
    !isAbsolute(context.fileToolsWorkingDirectory) ||
    context.workingDirectory.includes("\0") ||
    context.fileToolsWorkingDirectory.includes("\0")
  ) {
    return workspaceMismatch();
  }
  if (
    resolve(context.workingDirectory) !==
    resolve(context.fileToolsWorkingDirectory)
  ) {
    return workspaceMismatch();
  }
  return null;
}

function workspaceMismatch(): BashUnavailableResult {
  return {
    status: "error",
    type: "workspace_mismatch",
    message: "Bash and native file tools do not share one working directory.",
  };
}

export function sharedWorkingDirectory(
  context: BashExecutorContext,
): string | BashUnavailableResult {
  const mismatch = assertSharedWorkingDirectory(context);
  if (mismatch) return mismatch;
  return resolve(context.workingDirectory);
}
