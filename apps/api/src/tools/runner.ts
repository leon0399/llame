import { isBashTool, isHostCapabilityTool } from './bash';
import { isNativeFileTool } from './native-files';
import { Logger } from '@nestjs/common';

import {
  isRecord,
  truncateOversizedResult,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { safeParseArgs } from './schema-utils';
import { hasValidTrustedTimeout } from './turn-tool-catalog';
import { type Tool, type ToolContext, type ToolResult } from './types';

const logger = new Logger('ToolRunner');

class ToolAbortError extends Error {}

type PreparedToolExecution = {
  readonly context: ToolContext;
  readonly timeoutSignal: AbortSignal;
  readonly composedSignal: AbortSignal;
};

/**
 * The Bash watcher proves process-group quiescence within 250 ms and drains
 * its streams before resolving. Give that proof and the durable native.result
 * append a small bounded window; a hung database call must still fall back to
 * the unknown outcome.
 */
export const BASH_SETTLEMENT_GRACE_MS = 750;

/**
 * Race an execution against the exact signal passed to the tool. Cooperative
 * tools can stop work when it aborts; tools that ignore it still produce a
 * bounded result for the caller. The underlying work cannot be forcibly
 * cancelled. Native mutations check the signal before publication, and an
 * interrupted native mutation returns an unknown outcome rather than retrying.
 */
function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortGraceMs = 0,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const onAbort = () => {
      if (abortGraceMs === 0) {
        finish(() => reject(new ToolAbortError('Tool call aborted')));
        return;
      }
      if (graceTimer !== undefined) return;
      graceTimer = setTimeout(() => {
        finish(() => reject(new ToolAbortError('Tool call aborted')));
      }, abortGraceMs);
    };

    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) =>
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        ),
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function prepareToolExecution(
  tool: Tool,
  context: ToolContext,
  callTimeoutSeconds: number,
): PreparedToolExecution {
  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composedSignal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, timeoutSignal])
    : timeoutSignal;
  return {
    context: {
      ...context,
      abortSignal: composedSignal,
      timeoutSignal,
      timeoutMs,
    },
    timeoutSignal,
    composedSignal,
  };
}

/** Structured refusal for a tool the model requested but is unavailable (D3/D6). */
export function refusalResult(toolName: string): ToolResult {
  return {
    status: 'error',
    type: 'not_available',
    message: `Tool "${toolName}" is not available.`,
  };
}

/** Structured error for a hallucinated/invalid tool call the SDK couldn't parse. */
export function invalidCallResult(toolName: string): ToolResult {
  return {
    status: 'error',
    type: 'invalid_input',
    message: `The call to "${toolName}" had invalid arguments.`,
  };
}

/**
 * Execute a tool end-to-end: absent-identity fail-closed (D4), input
 * validation against the tool's own schema (2.2), the timeout wrapper (D6),
 * failure-to-structured-error (never throws), and result truncation. Never
 * throws — always resolves to a `ToolResult` the run loop can persist/stream.
 */
export async function runTool(
  tool: Tool,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by `admitToolCall`'s own `safeParseArgs(tool.inputSchema, args)` call, reached via the very first statement of this function's body.
  args: unknown,
  context: ToolContext | undefined,
  callTimeoutSeconds: number,
  /**
   * Fired once input validation passes, immediately before `tool.execute`
   * runs. NOT wired by the run loop's current caller
   * (`run-execution.service.ts` calls `runTool` with 4 args, no callback):
   * in practice the AI SDK already validates a call's arguments against the
   * tool's declared `inputSchema` before ever invoking the toolSet's
   * `execute` wrapper, so a schema-invalid call is caught upstream by
   * `experimental_repairToolCall`/`onUnavailableToolCall` and never reaches
   * `runTool` with bad args — this schema check and the seam below are
   * defense-in-depth for a caller that skips that upstream validation (e.g.
   * a test, or a future non-AI-SDK-driven tool invocation path), not
   * something the shipped loop currently relies on for its
   * requested/started distinction (that split is emitted around the
   * `runTool` call site instead — see `run-execution.service.ts`'s toolSet
   * `execute` wrapper). Available for a future caller that wants a
   * validated-vs-started split; do not assume it fires today.
   */
  onValidated?: () => void,
): Promise<ToolResult> {
  const admission = admitToolCall(tool, args, context, callTimeoutSeconds);
  if ('result' in admission) return admission.result;
  const { context: validContext, args: validArgs } = admission;
  const {
    context: executionContext,
    timeoutSignal,
    composedSignal,
  } = prepareToolExecution(tool, validContext, callTimeoutSeconds);
  onValidated?.();
  try {
    const execution = Promise.resolve(
      tool.execute(executionContext, validArgs),
    );
    const result = await withAbort(
      execution,
      composedSignal,
      isBashTool(tool) ? BASH_SETTLEMENT_GRACE_MS : 0,
    );
    if (
      isHostCapabilityTool(tool) &&
      result.status === 'error' &&
      result.type === 'outcome_unknown'
    )
      validContext.onNativeMutationUnknown?.();
    return truncateOversizedResult(result);
  } catch (error) {
    return classifyToolExecutionError(error, validContext, timeoutSignal, tool);
  }
}

/** How a caught `tool.execute` failure resolves: the caller's own
 * cancellation, this call's own timeout, or an unexplained throw — never
 * leaking stack traces or config values into the recorded result (same
 * redaction posture as instance-config); logged server-side only. */
function classifyToolExecutionError(
  error: unknown,
  context: ToolContext,
  timeoutSignal: AbortSignal,
  tool: Tool,
): ToolResult {
  if (isBashTool(tool) || (isNativeFileTool(tool) && tool.id !== 'read')) {
    context.onNativeMutationUnknown?.();
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The host command or mutation did not settle before interruption. Do not repeat it automatically.',
    };
  }
  const toolId = tool.id;
  if (context.abortSignal?.aborted) {
    return {
      status: 'error',
      type: 'cancelled',
      message: `Tool "${toolId}" was cancelled.`,
    };
  }
  if (timeoutSignal.aborted) {
    return {
      status: 'error',
      type: 'timeout',
      message: `Tool "${toolId}" timed out.`,
    };
  }
  logger.error(
    `Tool "${toolId}" threw`,
    error instanceof Error ? error.stack : String(error),
  );
  return {
    status: 'error',
    type: 'execution_failed',
    message: 'The tool failed to execute.',
  };
}

/**
 * The D4/D6 fail-closed guards (resolvable identity, not already cancelled,
 * a trusted timeout) plus schema validation (2.2), run before anything is
 * executed. Returns the narrowed context and validated args to proceed with,
 * or the `ToolResult` to return immediately.
 */
function admitToolCall(
  tool: Tool,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated via `safeParseArgs(tool.inputSchema, args)` a few statements down, after three unrelated guard checks (identity, abort, timeout) that must run first; genuinely validated, just not as this function's *first* statement, which the structural exemption requires.
  args: unknown,
  context: ToolContext | undefined,
  callTimeoutSeconds: number,
): { context: ToolContext; args: UnknownRecord } | { result: ToolResult } {
  if (!context?.userId) {
    // Defensive: the run loop always resolves an owner before offering
    // tools. A call with no resolvable identity must fail closed — no reads.
    return {
      result: {
        status: 'error',
        type: 'no_context',
        message: 'Tool execution requires a resolvable run owner.',
      },
    };
  }

  if (context.abortSignal?.aborted) {
    return {
      result: {
        status: 'error',
        type: 'cancelled',
        message: `Tool "${tool.id}" was cancelled.`,
      },
    };
  }

  if (!hasValidTrustedTimeout(tool.timeoutSeconds, callTimeoutSeconds)) {
    return { result: refusalResult(tool.id) };
  }

  const parsed = safeParseArgs(tool.inputSchema, args);
  if (!parsed.success || !isRecord(parsed.data)) {
    return {
      result: {
        status: 'error',
        type: 'invalid_input',
        message: `Invalid arguments for tool "${tool.id}".`,
      },
    };
  }

  return { context, args: parsed.data };
}
