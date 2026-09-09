export type ToolTerminationStatus = 'cancelled' | 'expired' | 'failed';
import { type ToolResult } from '@workspace/runtime-safety';

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
