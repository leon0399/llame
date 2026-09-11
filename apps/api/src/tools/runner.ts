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
import { evaluatePermission } from './permissions/evaluator';
import { isBashCommandField } from './permissions/built-in-policy';
import { declaredStringProperties } from './permissions/declared-fields';
import { nativeFileProjection } from './permissions/locator-projection';
import { permissionDeniedResult } from './permissions/messages';
import { type PermissionDecision } from './permissions/types';

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
 * Declared string fields for a dynamic MCP tool, checked against its currently
 * admitted declaration. A code-owned tool returns `undefined` (its fields were
 * validated at boot); an MCP tool with an unreadable declaration returns an
 * empty set so every configured field clause fails closed.
 */
function mcpDeclaredStringFields(tool: Tool): ReadonlySet<string> | undefined {
  if (!tool.id.startsWith('mcp__')) return undefined;
  if (!isRecord(tool.inputSchema)) return new Set();
  return declaredStringProperties(tool.inputSchema);
}

/**
 * Evaluate the trusted process policy for one already-schema-validated call.
 * `undefined` means no trusted policy was supplied (a code error); the caller
 * converts it to a fail-closed rejection. The originally submitted `args` are
 * matched, never the schema-defaulted executor copy.
 */
function evaluateToolPermission(
  tool: Tool,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- originally submitted tool-call input; `admitToolCall` already validated it against the tool's own schema before this is reached.
  args: unknown,
  context: ToolContext,
): PermissionDecision | undefined {
  const policy = context.permissionPolicy;
  if (policy === undefined) return undefined;
  return evaluatePermission(policy, {
    toolId: tool.id,
    args,
    isFlexibleWhitespaceField: (field) => isBashCommandField(tool.id, field),
    projectFieldValue: nativeFileProjection(tool.id),
    validFields: mcpDeclaredStringFields(tool),
  });
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
   * Fired after identity/schema checks and the permission decision, before any
   * executor dispatch. The run wrapper records the trusted decision durably and
   * only then emits `tool.started` for an allowed call. Direct callers that
   * omit it still cannot bypass the gate: the decision is evaluated here
   * regardless, and an absent trusted policy rejects.
   */
  onAdmitted?: (decision: PermissionDecision) => void | Promise<void>,
): Promise<ToolResult> {
  const admission = admitToolCall(tool, args, context, callTimeoutSeconds);
  if ('result' in admission) return admission.result;
  const { context: validContext, args: validArgs } = admission;

  const decision = evaluateToolPermission(tool, args, validContext);
  if (decision === undefined) return permissionDeniedResult('no_allow');
  if (onAdmitted !== undefined) await onAdmitted(decision);
  if (decision.decision === 'reject') {
    return permissionDeniedResult(decision.reason);
  }

  return executeAdmittedTool(tool, validArgs, validContext, callTimeoutSeconds);
}

/** Run an admitted tool under its composed timeout/abort signal and map any
 *  failure to a structured result. Never throws. */
async function executeAdmittedTool(
  tool: Tool,
  validArgs: UnknownRecord,
  context: ToolContext,
  callTimeoutSeconds: number,
): Promise<ToolResult> {
  const {
    context: executionContext,
    timeoutSignal,
    composedSignal,
  } = prepareToolExecution(tool, context, callTimeoutSeconds);
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
      context.onNativeMutationUnknown?.();
    return truncateOversizedResult(result);
  } catch (error) {
    return classifyToolExecutionError(error, context, timeoutSignal, tool);
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
