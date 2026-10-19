export type RequestBudget = {
  /** Aborts when the time budget runs out or the caller cancels. */
  readonly signal: AbortSignal;
  /** Whether the budget ran out, which refuses the answer it raced. */
  readonly expired: () => boolean;
  readonly dispose: () => void;
};

/**
 * The time budget of one request, measured from its receipt. The daemon
 * refuses an exhausted budget before any effect and terminates in-flight work
 * when it runs out mid-call.
 */
export function startRequestBudget(
  budgetMs: number,
  channelSignal: AbortSignal,
): RequestBudget {
  const controller = new AbortController();
  let expired = false;
  const forward = (): void => {
    controller.abort();
  };
  if (channelSignal.aborted) forward();
  else channelSignal.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, budgetMs);
  return {
    signal: controller.signal,
    expired: () => expired,
    dispose: () => {
      clearTimeout(timer);
      channelSignal.removeEventListener("abort", forward);
    },
  };
}
