import { foregroundBoundMs, BASH_SETTLEMENT_GRACE_MS } from './bash-limits';
import type { Tool, ToolContext } from './types';

export type PreparedToolExecution = {
  readonly context: ToolContext;
  readonly timeoutSignal: AbortSignal;
  readonly composedSignal: AbortSignal;
  readonly dispose?: () => void;
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

  const move =
    context.yieldSignal !== undefined && moveDeadlineAt !== undefined
      ? prepareMoveSignal(context.yieldSignal, timeoutSignal, moveDeadlineAt)
      : { signal: timeoutSignal, dispose: undefined };

  const moveSignal = move.signal;

  const composedSignal = context.abortSignal
    ? AbortSignal.any([context.abortSignal, moveSignal])
    : moveSignal;

  return {
    context: {
      ...context,
      ...(separateTimeout
        ? {
            moveSignal,
            moveDeadlineAt,
            timeoutSignal: undefined,
          }
        : { abortSignal: composedSignal, timeoutSignal }),
      timeoutMs,
    },
    timeoutSignal,
    composedSignal,
    dispose: move.dispose,
  };
}

/** A segment yield owns one absolute deadline, even before the call starts. */
function prepareMoveSignal(
  source: AbortSignal,
  timeout: AbortSignal,
  boundDeadline: number,
) {
  const yielded = new AbortController();

  const onYield = () =>
    yielded.abort({
      cause: 'message',
      deadlineAt: Math.min(
        boundDeadline,
        performance.now() + BASH_SETTLEMENT_GRACE_MS,
      ),
    });

  if (source.aborted) onYield();
  else source.addEventListener('abort', onYield, { once: true });

  return {
    signal: AbortSignal.any([timeout, yielded.signal]),
    dispose: () => source.removeEventListener('abort', onYield),
  };
}
