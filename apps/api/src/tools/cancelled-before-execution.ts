import { type ToolResult } from './types';

/** The result of a call whose abort landed before its executor began. */
export function cancelledBeforeExecution(toolId: string): ToolResult {
  return {
    status: 'error',
    type: 'cancelled',
    message: `Tool "${toolId}" was cancelled.`,
  };
}

/** Whether `result` is {@link cancelledBeforeExecution}: the executor never ran. */
export function isCancelledBeforeExecution(
  result: ToolResult,
  toolId: string,
): boolean {
  const expected = cancelledBeforeExecution(toolId);

  return (
    result.status === 'error' &&
    result.type === expected.type &&
    result.message === expected.message
  );
}
