import type { AwaitingQuota } from '../db/schema';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { quotaWaitForFailure } from '../runs/quota-wait';
import type { QuotaRequestState } from '../runs/quota-wake-projection';

export type CompactionQuotaWaitPolicy = {
  readonly maxSeconds: number;
  readonly request: QuotaRequestState | undefined;
};

export class CompactionQuotaWait extends Error {
  constructor(readonly awaiting: AwaitingQuota) {
    super('Compaction summary is waiting for provider quota to reset.');
    this.name = 'CompactionQuotaWait';
  }
}

export function compactionQuotaWait(
  error: unknown,
  policy: CompactionQuotaWaitPolicy | undefined,
): CompactionQuotaWait | undefined {
  if (error instanceof CompactionQuotaWait) return error;

  if (policy === undefined || !(error instanceof ProviderFailure)) {
    return undefined;
  }

  const awaiting = quotaWaitForFailure(
    error,
    policy.maxSeconds,
    policy.request,
  );

  return awaiting === undefined ? undefined : new CompactionQuotaWait(awaiting);
}
