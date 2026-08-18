import { Logger } from '@nestjs/common';

import { truncateOversizedResult } from './result-truncation';
import { safeParseArgs } from './schema-utils';
import { hasValidTrustedTimeout } from './turn-tool-catalog';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isRecord } from '../unknown-record';

const logger = new Logger('ToolRunner');

class ToolAbortError extends Error {}

/**
 * Race an execution against the exact signal passed to the tool. Cooperative
 * tools can stop work when it aborts; tools that ignore it still produce a
 * bounded result for the caller. The underlying work cannot be forcibly
 * cancelled, which is safe here because every executable tool is read-only
 * (D6b).
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ToolAbortError('Tool call aborted'));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
  if (!context?.userId) {
    // Defensive: the run loop always resolves an owner before offering
    // tools. A call with no resolvable identity must fail closed — no reads.
    return {
      status: 'error',
      type: 'no_context',
      message: 'Tool execution requires a resolvable run owner.',
    };
  }

  if (context.abortSignal?.aborted) {
    return {
      status: 'error',
      type: 'cancelled',
      message: `Tool "${tool.id}" was cancelled.`,
    };
  }

  if (!hasValidTrustedTimeout(tool.timeoutSeconds, callTimeoutSeconds)) {
    return refusalResult(tool.id);
  }

  const parsed = safeParseArgs(tool.inputSchema, args);
  if (!parsed.success || !isRecord(parsed.data)) {
    return {
      status: 'error',
      type: 'invalid_input',
      message: `Invalid arguments for tool "${tool.id}".`,
    };
  }

  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composedSignal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, timeoutSignal])
    : timeoutSignal;
  const executionContext: ToolContext = {
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
  } catch (error) {
    if (context.abortSignal?.aborted) {
      return {
        status: 'error',
        type: 'cancelled',
        message: `Tool "${tool.id}" was cancelled.`,
      };
    }
    if (timeoutSignal.aborted) {
      return {
        status: 'error',
        type: 'timeout',
        message: `Tool "${tool.id}" timed out.`,
      };
    }
    // Never leak stack traces or config values into the recorded result
    // (same redaction posture as instance-config) — log server-side only.
    logger.error(
      `Tool "${tool.id}" threw`,
      error instanceof Error ? error.stack : String(error),
    );
    return {
      status: 'error',
      type: 'execution_failed',
      message: 'The tool failed to execute.',
    };
  }
}
