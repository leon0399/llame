import {
  runTool as runHarnessTool,
  type Tool,
  type ToolResult,
  type UnknownRecord,
} from '@workspace/harness';

import { type ToolContext } from './types';

export {
  hasValidTrustedTimeout,
  invalidCallResult,
  refusalResult,
} from '@workspace/harness';

/**
 * API entry point for the shared harness tool runner: binds the harness's
 * fail-closed execution to this host's identity transport. A call whose
 * trusted context carries no resolvable owner is refused here, before any
 * tool logic runs — the same contract the pre-extraction runner enforced.
 */
export async function runTool(
  tool: Tool<UnknownRecord, ToolContext>,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- this wrapper forwards `args` verbatim to the harness runner, which IS the boundary parse (`safeParseArgs` against the tool's declared schema); nothing here consumes it.
  args: unknown,
  context: ToolContext | undefined,
  callTimeoutSeconds: number,
  onValidated?: () => void,
): Promise<ToolResult> {
  if (!context?.userId) {
    return {
      status: 'error',
      type: 'no_context',
      message: 'Tool execution requires a resolvable run owner.',
    };
  }
  return runHarnessTool(tool, args, context, callTimeoutSeconds, onValidated);
}
