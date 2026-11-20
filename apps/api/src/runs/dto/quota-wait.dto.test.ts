import { describe, expect, it } from 'vitest';

import { toQuotaWaitResponse } from './quota-wait.dto';

const awaiting = {
  kind: 'quota' as const,
  failureClass: 'rate_limited' as const,
  resetsAt: '2026-11-20T12:00:00.000Z',
  wakeAt: '2026-11-20T12:01:00.000Z',
  resumeAt: 'preDispatch' as const,
  waitCount: 3,
};

describe('toQuotaWaitResponse', () => {
  it('returns the scheduling-safe allowlist for a quota wait', () => {
    const result = toQuotaWaitResponse('awaiting_quota', awaiting);

    expect(result).toEqual({
      failureClass: 'rate_limited',
      resetsAt: awaiting.resetsAt,
      wakeAt: awaiting.wakeAt,
    });
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'failureClass',
      'resetsAt',
      'wakeAt',
    ]);
  });

  it('returns null for every non-quota-wait state', () => {
    expect(toQuotaWaitResponse('queued', awaiting)).toBeNull();
    expect(
      toQuotaWaitResponse('awaiting_jobs', {
        kind: 'jobs',
        toolCallId: 'private-call',
        toolInput: { jobs: ['private-job'] },
        jobIds: ['private-job'],
        deadline: awaiting.wakeAt,
      }),
    ).toBeNull();
    expect(toQuotaWaitResponse('awaiting_quota', null)).toBeNull();
  });

  it('rejects malformed timestamps rather than emitting non-ISO values', () => {
    expect(
      toQuotaWaitResponse('awaiting_quota', {
        ...awaiting,
        wakeAt: 'not-a-date',
      }),
    ).toBeNull();
    expect(
      toQuotaWaitResponse('awaiting_quota', {
        ...awaiting,
        resetsAt: '2026-11-20T12:00:00Z',
      }),
    ).toBeNull();
  });
});
