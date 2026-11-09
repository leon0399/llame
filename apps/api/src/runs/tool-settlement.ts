export type ToolTerminationStatus = 'cancelled' | 'expired' | 'failed';
import { type ToolResult } from '@workspace/runtime-safety';

import { unknownMcpExecution } from '../tools/runner';

const MESSAGES = {
  cancelled: 'The run was cancelled before this tool finished.',
  expired: 'The run expired before this tool finished.',
  failed: 'The run failed before this tool finished.',
} satisfies Record<ToolTerminationStatus, string>;

export function toolTerminationMessage(status: ToolTerminationStatus): string {
  return MESSAGES[status];
}

export function toolTerminationResult(
  status: ToolTerminationStatus,
  toolName: string,
): ToolResult {
  if (toolName === 'bash') {
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The host command was interrupted. Inspect the current host state before a new attempt.',
    };
  }
  if (toolName === 'edit' || toolName === 'write') {
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The native mutation was interrupted. Inspect the current file before a new attempt.',
    };
  }
  return {
    status: 'error',
    type: 'cancelled',
    message: toolTerminationMessage(status),
  };
}

/** What the executor knows of an open call when an owner interrupt settles it. */
export type InterruptedCall = {
  readonly toolName: string;
  /** The call passed admission, so its executor may have begun. */
  readonly started: boolean;
  /** An MCP call recorded its `native.attempt`: the request was sent. */
  readonly mcpDispatched: boolean;
};

export type InterruptSettlement = {
  readonly result: ToolResult;
  /** The call started and was stopped, so its effects are unknown. */
  readonly stopped: boolean;
};

/**
 * The result an interrupt stores for an open call whose fate is `cancel`
 * (run-steering D7), and whether the call started and was stopped, so the
 * `interrupted` notice names it.
 */
export function interruptSettlementOf(
  call: InterruptedCall,
): InterruptSettlement {
  const notRun: ToolResult = {
    status: 'error',
    type: 'cancelled',
    message:
      'This call did not run. The owner interrupted the step before it started. Run it again if you still need it.',
  };
  if (!call.started) return { result: notRun, stopped: false };
  if (call.toolName === 'bash') {
    return {
      result: toolTerminationResult('cancelled', 'bash'),
      stopped: true,
    };
  }
  if (call.toolName.startsWith('mcp__')) {
    // A request that was never sent changed nothing.
    return call.mcpDispatched
      ? { result: unknownMcpExecution(), stopped: true }
      : { result: notRun, stopped: false };
  }
  return {
    result: {
      status: 'error',
      type: 'cancelled',
      message:
        'The owner interrupted this call before it finished. It made no change.',
    },
    stopped: false,
  };
}
