import { truncateOversizedResult } from "./result-truncation";
import { safeParseArgs } from "./schema-utils";
import { isRecord, type UnknownRecord } from "../unknown-record";
import { type BaseToolContext, type Tool, type ToolResult } from "./types";

class ToolAbortError extends Error {}

const MAX_ABORT_TIMEOUT_MS = 2_147_483_647;

function isRepresentableAbortTimeout(timeoutSeconds: number): boolean {
  const timeoutMilliseconds = timeoutSeconds * 1000;
  return (
    Number.isInteger(timeoutMilliseconds) &&
    timeoutMilliseconds >= 1 &&
    timeoutMilliseconds <= MAX_ABORT_TIMEOUT_MS
  );
}

/**
 * Whether a tool's trusted `timeoutSeconds` override may be applied over the
 * caller's `callTimeoutSeconds`: both must be representable as AbortSignal
 * timeouts, and an override may only tighten the bound, never widen it.
 */
export function hasValidTrustedTimeout(
  timeoutSeconds: number | undefined,
  callTimeoutSeconds: number,
): boolean {
  if (!isRepresentableAbortTimeout(callTimeoutSeconds)) {
    return false;
  }
  return (
    timeoutSeconds === undefined ||
    (isRepresentableAbortTimeout(timeoutSeconds) &&
      timeoutSeconds <= callTimeoutSeconds)
  );
}

/**
 * Race an execution against the exact signal passed to the tool. Cooperative
 * tools can stop work when it aborts; tools that ignore it still produce a
 * bounded result for the caller.
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ToolAbortError("Tool call aborted"));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Structured refusal for a tool the model requested but is unavailable (D3/D6). */
export function refusalResult(toolName: string): ToolResult {
  return {
    status: "error",
    type: "not_available",
    message: `Tool "${toolName}" is not available.`,
  };
}

/** Structured error for a hallucinated/invalid tool call the SDK couldn't parse. */
export function invalidCallResult(toolName: string): ToolResult {
  return {
    status: "error",
    type: "invalid_input",
    message: `The call to "${toolName}" had invalid arguments.`,
  };
}

/**
 * Execute a tool end-to-end: absent-context fail-closed (D4), input
 * validation against the tool's own schema (2.2), the timeout wrapper (D6),
 * failure-to-structured-error (never throws), and result truncation. Never
 * throws — always resolves to a `ToolResult` the run loop can persist or
 * record.
 */
export async function runTool<TContext extends BaseToolContext>(
  tool: Tool<UnknownRecord, TContext>,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- this whole function's body IS `args`'s validation: `safeParseArgs(tool.inputSchema, args)` runs below, after the identity/abort/timeout guards that must run first; genuinely validated, just not as this function's *first* statement.
  args: unknown,
  context: TContext | undefined,
  callTimeoutSeconds: number,
  /**
   * Fired once input validation passes, immediately before `tool.execute`
   * runs. Lets a caller distinguish a validated call from one that actually
   * started executing.
   */
  onValidated?: () => void,
): Promise<ToolResult> {
  if (!context) {
    // Defensive: the run loop always resolves a trusted context before
    // offering tools. A call with no context must fail closed — no reads.
    return {
      status: "error",
      type: "no_context",
      message: "Tool execution requires a resolvable trusted context.",
    };
  }

  if (context.abortSignal?.aborted) {
    return {
      status: "error",
      type: "cancelled",
      message: `Tool "${tool.id}" was cancelled.`,
    };
  }

  if (!hasValidTrustedTimeout(tool.timeoutSeconds, callTimeoutSeconds)) {
    return refusalResult(tool.id);
  }

  const parsed = safeParseArgs(tool.inputSchema, args);
  if (!parsed.success || !isRecord(parsed.data)) {
    return {
      status: "error",
      type: "invalid_input",
      message: `Invalid arguments for tool "${tool.id}".`,
    };
  }

  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composedSignal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, timeoutSignal])
    : timeoutSignal;
  const executionContext: TContext = {
    ...context,
    abortSignal: composedSignal,
  };
  onValidated?.();
  try {
    const result = await withAbort(
      Promise.resolve(tool.execute(executionContext, parsed.data)),
      composedSignal,
    );
    return truncateOversizedResult(result);
  } catch {
    if (context.abortSignal?.aborted) {
      return {
        status: "error",
        type: "cancelled",
        message: `Tool "${tool.id}" was cancelled.`,
      };
    }
    if (timeoutSignal.aborted) {
      return {
        status: "error",
        type: "timeout",
        message: `Tool "${tool.id}" timed out.`,
      };
    }
    // Never leak stack traces or environment values into the recorded
    // result — the host decides what is worth logging locally.
    return {
      status: "error",
      type: "execution_failed",
      message: "The tool failed to execute.",
    };
  }
}
