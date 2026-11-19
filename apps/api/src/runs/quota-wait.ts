import type { ProviderFailure } from '../models/provider-failure/provider-failure';
import type { AwaitingQuota } from '../db/schema';
import type { QuotaRequestState } from './quota-wake-projection';

export function quotaWaitForFailure(
  error: ProviderFailure,
  maxSeconds: number,
  request: QuotaRequestState | undefined,
): AwaitingQuota | undefined {
  if (error.code !== 'quota_exhausted' && error.code !== 'rate_limited')
    return undefined;

  const resetsAt = error.resetsAt;

  if (resetsAt === undefined || error.toolCallStarted) return undefined;

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
