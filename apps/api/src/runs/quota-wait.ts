import type { ProviderFailure } from '../models/provider-failure/provider-failure';
import type { AwaitingQuota } from '../db/schema';
import type { QuotaRequestState } from './quota-wake-projection';

/**
 * How a caller treats a send that started a tool call. The shipped rule
 * refuses it: the request fails with its class, and the caller's own rules
 * apply. The failed-send decision parks that Run after its calls settle
 * (continue-after-broken-send D6), so it asks for the after-cut mode.
 */
export type QuotaWaitOptions = {
  /** Accept a send that already started a tool call, and park after the cut. */
  readonly afterCut?: boolean;
};

export function quotaWaitForFailure(
  error: ProviderFailure,
  maxSeconds: number,
  request: QuotaRequestState | undefined,
  options: QuotaWaitOptions = {},
): AwaitingQuota | undefined {
  if (error.code !== 'quota_exhausted' && error.code !== 'rate_limited')
    return undefined;

  const resetsAt = error.resetsAt;

  if (
    resetsAt === undefined ||
    (error.toolCallStarted && options.afterCut !== true)
  )
    return undefined;

  const remaining = resetsAt - Date.now();

  if (
    remaining <= 60_000 ||
    remaining > maxSeconds * 1000 ||
    (request?.waitCount ?? 0) >= 4
  )
    return undefined;

  return {
    kind: 'quota',
    failureClass: error.code,
    resetsAt: new Date(resetsAt).toISOString(),
    wakeAt: new Date(
      resetsAt + 60_000 + Math.floor(Math.random() * 18_001),
    ).toISOString(),
    resumeAt: request?.resumeAt ?? 'request',
    waitCount: (request?.waitCount ?? 0) + 1,
  };
}
