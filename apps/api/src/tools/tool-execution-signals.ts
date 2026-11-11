import { foregroundBoundMs, BASH_SETTLEMENT_GRACE_MS } from './bash-limits';
import type { Tool, ToolContext } from './types';

export type PreparedToolExecution = {
  readonly context: ToolContext;
  readonly timeoutSignal: AbortSignal;
  readonly composedSignal: AbortSignal;
};

export function prepareToolExecution(
  tool: Tool,
  context: ToolContext,
  callTimeoutSeconds: number,
  separateTimeout: boolean,
): PreparedToolExecution {
  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;

  const boundMs = separateTimeout
    ? foregroundBoundMs(context.bashBackgroundAfterSeconds, timeoutMs)
    : timeoutMs;

  const moveDeadlineAt = separateTimeout
    ? performance.now() + boundMs + BASH_SETTLEMENT_GRACE_MS
    : undefined;

  const timeoutSignal = AbortSignal.timeout(boundMs);

  const composedSignal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, timeoutSignal])
    : timeoutSignal;

  return {
    context: {
      ...context,
      ...(separateTimeout
        ? {
            moveSignal: timeoutSignal,
            moveDeadlineAt,
            timeoutSignal: undefined,
          }
        : { abortSignal: composedSignal, timeoutSignal }),
      timeoutMs,
    },
    timeoutSignal,
    composedSignal,
  };
}
