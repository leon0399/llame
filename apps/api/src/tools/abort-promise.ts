import { messageMoveWindow } from './bash-limits';

class ToolAbortError extends Error {}

function abortGraceDuration(signal: AbortSignal, abortGraceMs: number): number {
  const window = abortGraceMs === 0 ? undefined : messageMoveWindow(signal);

  return window === undefined
    ? abortGraceMs
    : Math.max(0, window.deadlineAt - performance.now());
}

/** Race work against an abort signal, optionally honoring its move deadline. */
export function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortGraceMs = 0,
  ignoreAbort?: () => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(graceTimer);
    };

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };

    const abort = () => {
      if (ignoreAbort?.()) return;

      finish(() => reject(new ToolAbortError('Tool call aborted')));
    };

    const onAbort = () => {
      const graceMs = abortGraceDuration(signal, abortGraceMs);

      if (graceMs === 0) abort();
      else graceTimer ??= setTimeout(abort, graceMs);
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
