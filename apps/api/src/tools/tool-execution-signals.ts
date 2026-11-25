import { foregroundBoundMs, BASH_SETTLEMENT_GRACE_MS } from './bash-limits';
import type { Tool, ToolContext } from './types';

export type PreparedToolExecution = {
  readonly context: ToolContext;
  readonly timeoutSignal: AbortSignal;
  readonly composedSignal: AbortSignal;
  readonly dispose?: () => void;
};

type TimeoutMode = 'call' | 'promotion' | 'job';

export function prepareToolExecution(
  tool: Tool,
  context: ToolContext,
  callTimeoutSeconds: number,
  mode: TimeoutMode,
): PreparedToolExecution {
  if (mode === 'job') return prepareDaemonJobExecution(context);

  const timeoutMs = (tool.timeoutSeconds ?? callTimeoutSeconds) * 1000;

  const boundMs =
    mode === 'promotion'
      ? foregroundBoundMs(context.bashBackgroundAfterSeconds, timeoutMs)
      : timeoutMs;

  return prepareTimedExecution(context, timeoutMs, boundMs, mode);
}

function prepareDaemonJobExecution(
  context: ToolContext,
): PreparedToolExecution {
  const signal = context.abortSignal ?? new AbortController().signal;
  const composedSignal = context.abortSignal ?? signal;

  return {
    context: {
      ...context,
      moveSignal: context.yieldSignal,
      timeoutSignal: undefined,
      timeoutMs: undefined,
    },
    timeoutSignal: signal,
    composedSignal,
  };
}

function prepareTimedExecution(
  context: ToolContext,
  timeoutMs: number,
  boundMs: number,
  mode: Exclude<TimeoutMode, 'job'>,
): PreparedToolExecution {
  const timeoutSignal = AbortSignal.timeout(boundMs);

  if (mode === 'call')
    return prepareCallExecution(context, timeoutMs, timeoutSignal);

  return preparePromotionExecution(context, timeoutMs, boundMs, timeoutSignal);
}

function prepareCallExecution(
  context: ToolContext,
  timeoutMs: number,
  timeoutSignal: AbortSignal,
): PreparedToolExecution {
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

function preparePromotionExecution(
  context: ToolContext,
  timeoutMs: number,
  boundMs: number,
  timeoutSignal: AbortSignal,
): PreparedToolExecution {
  const moveDeadlineAt = performance.now() + boundMs + BASH_SETTLEMENT_GRACE_MS;

  const move =
    context.yieldSignal === undefined
      ? { signal: timeoutSignal, dispose: undefined }
      : prepareMoveSignal(context.yieldSignal, timeoutSignal, moveDeadlineAt);

  return {
    context: {
      ...context,
      moveSignal: move.signal,
      moveDeadlineAt,
      timeoutSignal: undefined,
      timeoutMs,
    },
    timeoutSignal,
    composedSignal: context.abortSignal
      ? AbortSignal.any([context.abortSignal, move.signal])
      : move.signal,
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
