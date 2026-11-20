import { ApiProperty } from '@nestjs/swagger';

import type { RunAwaiting, RunStatus } from '../../db/schema';

/** The public, scheduling-safe projection of a quota-waiting Run. */
export class QuotaWaitResponse {
  @ApiProperty({ enum: ['quota_exhausted', 'rate_limited'] })
  failureClass!: 'quota_exhausted' | 'rate_limited';

  @ApiProperty({ format: 'date-time' })
  resetsAt!: string;

  @ApiProperty({ format: 'date-time' })
  wakeAt!: string;
}

/** Exposes only the public quota wait facts, never the internal wait ledger. */
export function toQuotaWaitResponse(
  status: RunStatus,
  awaiting: RunAwaiting | null | undefined,
): QuotaWaitResponse | null {
  if (status !== 'awaiting_quota' || awaiting?.kind !== 'quota') return null;

  const { failureClass, resetsAt, wakeAt } = awaiting;

  if (
    (failureClass !== 'quota_exhausted' && failureClass !== 'rate_limited') ||
    !isIsoDateTime(resetsAt) ||
    !isIsoDateTime(wakeAt)
  )
    return null;

  return { failureClass, resetsAt, wakeAt };
}

function isIsoDateTime(value: string): boolean {
  const timestamp = Date.parse(value);

  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}
