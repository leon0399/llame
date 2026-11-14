import { Logger } from '@nestjs/common';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { isBashTool } from './bash';
import { isHostBashCall } from './bash-target';
import { BASH_SETTLEMENT_GRACE_MS } from './bash-limits';
import { isNativeFileTool } from './native-files';
import { capToolResult } from './artifacts/spill';
import { cancelledBeforeExecution } from './cancelled-before-execution';
import { type Tool, type ToolContext, type ToolResult } from './types';
import {
  prepareToolExecution,
  type PreparedToolExecution,
} from './tool-execution-signals';
import { withAbort } from './abort-promise';

const logger = new Logger('ToolRunner');

/** Run an admitted tool under its composed timeout/abort signal and map any
 *  failure to a structured result. Never throws. An abort that landed during
 *  the awaited admission write must not reach an executor. */
export async function executeAdmittedTool(
  tool: Tool,
  validArgs: UnknownRecord,
  context: ToolContext,
  callTimeoutSeconds: number,
): Promise<ToolResult> {
  if (context.abortSignal?.aborted) return cancelledBeforeExecution(tool.id);

  const isHostBash = isBashTool(tool) && isHostBashCall(validArgs, context);

  const prepared = prepareToolExecution(
    tool,
    context,
    callTimeoutSeconds,
    isHostBash,
  );

  return settleAdmittedExecution(tool, validArgs, context, prepared);
}

type ExecutionMarkers = {
  mcpDispatchRecorded: boolean;
  hostCommandStarted: boolean;
  hostPromotionStarted: boolean;
};

function executionContextFor(
  prepared: PreparedToolExecution,
  context: ToolContext,
  markers: ExecutionMarkers,
): ToolContext {
  return {
    ...prepared.context,
    onHostCommandStarted: () => {
      markers.hostCommandStarted = true;
      context.onHostCommandStarted?.();
    },
    onHostPromotionStarted: () => {
      markers.hostPromotionStarted = true;
      context.onHostPromotionStarted?.();
    },
    onMcpDispatchRecorded: () => {
      markers.mcpDispatchRecorded = true;
      context.onMcpDispatchRecorded?.();
    },
  };
}

function executeUnderAbortFence(
  tool: Tool,
  validArgs: UnknownRecord,
  {
    context,
    prepared,
    executionContext,
    markers,
  }: {
    context: ToolContext;
    prepared: PreparedToolExecution;
    executionContext: ToolContext;
    markers: ExecutionMarkers;
  },
): Promise<ToolResult> {
  return withAbort(
    Promise.resolve(tool.execute(executionContext, validArgs)),
    prepared.composedSignal,
    isBashTool(tool) ? BASH_SETTLEMENT_GRACE_MS : 0,
    isBashTool(tool) && isHostBashCall(validArgs, context)
      ? () => markers.hostPromotionStarted
      : undefined,
  );
}

function classifyAdmittedFailure(
  error: unknown,
  {
    tool,
    validArgs,
    context,
    prepared,
    markers,
  }: {
    tool: Tool;
    validArgs: UnknownRecord;
    context: ToolContext;
    prepared: PreparedToolExecution;
    markers: ExecutionMarkers;
  },
): ToolResult {
  const hostBashCancelledBeforeStart =
    isBashTool(tool) &&
    isHostBashCall(validArgs, context) &&
    !markers.hostCommandStarted &&
    (context.abortSignal?.aborted === true ||
      context.moveSignal?.aborted === true ||
      context.yieldSignal?.aborted === true);

  return classifyToolExecutionError(error, {
    context,
    timeoutSignal: prepared.timeoutSignal,
    tool,
    mcpDispatchRecorded: markers.mcpDispatchRecorded,
    hostBashCancelledBeforeStart,
  });
}

async function settleAdmittedExecution(
  tool: Tool,
  validArgs: UnknownRecord,
  context: ToolContext,
  prepared: PreparedToolExecution,
): Promise<ToolResult> {
  const markers: ExecutionMarkers = {
    mcpDispatchRecorded: false,
    hostCommandStarted: false,
    hostPromotionStarted: false,
  };

  const executionContext = executionContextFor(prepared, context, markers);

  try {
    const result = await executeUnderAbortFence(tool, validArgs, {
      context,
      prepared,
      executionContext,
      markers,
    });

    notifyUnknownOutcome(tool, context, result);

    return await capToolResult(tool, context, result);
  } catch (error) {
    const result = classifyAdmittedFailure(error, {
      tool,
      validArgs,
      context,
      prepared,
      markers,
    });

    notifyUnknownOutcome(tool, context, result);

    return await capToolResult(tool, context, result);
  } finally {
    prepared.dispose?.();
  }
}

export function unknownMcpExecution(): ToolResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    message:
      'The MCP operation may have executed; inspect the current state before retrying. It will not be repeated automatically.',
  };
}

/** Abort only uncertain native file mutations. Live bash/MCP unknowns are
 * observations; the model keeps the structured result and the Run continues. */
function notifyUnknownOutcome(
  tool: Tool,
  context: ToolContext,
  result: ToolResult,
): void {
  if (result.status !== 'error' || result.type !== 'outcome_unknown') {
    return;
  }

  if (!isNativeFileTool(tool) || tool.id === 'read') {
    return;
  }

  context.onNativeMutationUnknown?.();
}

function unknownNativeExecution(tool: Tool): ToolResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    message: isBashTool(tool)
      ? 'Command outcome could not be established; inspect the workspace before retrying. The attempt will not be replayed automatically.'
      : 'The host command or mutation did not settle before interruption. Do not repeat it automatically.',
  };
}

/** How a caught `tool.execute` failure resolves: the caller's own
 * cancellation, this call's own timeout, or an unexplained throw — never
 * leaking stack traces or config values into the recorded result (same
 * redaction posture as instance-config); logged server-side only. */
function classifyToolExecutionError(
  error: unknown,
  {
    context,
    timeoutSignal,
    tool,
    mcpDispatchRecorded,
    hostBashCancelledBeforeStart,
  }: {
    context: ToolContext;
    timeoutSignal: AbortSignal;
    tool: Tool;
    mcpDispatchRecorded: boolean;
    hostBashCancelledBeforeStart: boolean;
  },
): ToolResult {
  if (hostBashCancelledBeforeStart) return cancelledBeforeExecution('bash');

  if (tool.id.startsWith('mcp__') && mcpDispatchRecorded) {
    return unknownMcpExecution();
  }

  if (isBashTool(tool) || (isNativeFileTool(tool) && tool.id !== 'read')) {
    return unknownNativeExecution(tool);
  }

  return classifyOrdinaryFailure(error, context, timeoutSignal, tool.id);
}

function classifyOrdinaryFailure(
  error: unknown,
  context: ToolContext,
  timeoutSignal: AbortSignal,
  toolId: string,
): ToolResult {
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
