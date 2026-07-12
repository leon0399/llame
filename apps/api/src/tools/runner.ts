import { Logger } from '@nestjs/common';

import { type Tool, type ToolContext, type ToolResult } from './types';

const logger = new Logger('ToolRunner');

/** ~16KB result cap (D5/D6): oversized tool output is truncated, visibly. */
export const RESULT_TRUNCATE_CHARS = 16_000;

class ToolTimeoutError extends Error {}

/**
 * Registry-owned timeout wrapper (D6): `AbortSignal.timeout` races the
 * tool's promise — no SDK dependency, the wrapper is ours. The underlying
 * call isn't forcibly cancelled (nothing here supports real cancellation of
 * a Postgres query mid-flight), but the caller gets a bounded, structured
 * timeout result regardless — safe because every executable tool this slice
 * is read-only (D6b).
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const onAbort = () => reject(new ToolTimeoutError('Tool call timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
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

/**
 * Truncate an oversized SUCCESS result to the cap, with a visible marker
 * (D6). Error results are never truncated — every error message this
 * registry produces is a short, statically-authored string (see
 * refusalResult/invalidCallResult and the catch branches below), so an
 * oversized error can only mean a bug elsewhere, not something to silently
 * cap here.
 */
function truncateIfOversized(result: ToolResult): ToolResult {
  if (result.status !== 'success') {
    return result;
  }
  const json = JSON.stringify(result);
  if (json.length <= RESULT_TRUNCATE_CHARS) {
    return result;
  }
  return {
    status: 'success',
    truncated: true,
    message: `Result truncated to ${RESULT_TRUNCATE_CHARS} characters.`,
    preview: json.slice(0, RESULT_TRUNCATE_CHARS),
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

  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: 'error',
      type: 'invalid_input',
      message: `Invalid arguments for tool "${tool.id}".`,
    };
  }

  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;
  onValidated?.();
  try {
    const result = await withTimeout(
      Promise.resolve(tool.execute(context, parsed.data as never)),
      timeoutMs,
    );
    return truncateIfOversized(result);
  } catch (error) {
    if (error instanceof ToolTimeoutError) {
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
