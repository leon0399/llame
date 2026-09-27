import { describe, expect, it } from 'vitest';

import { type Run } from '../../db/schema';
import { toContextReceiptResponse } from './runs.dto';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  chatId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  userId: 'owner',
  modelId: 'system:openai:public-model',
  effort: null,
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: new Date('2026-07-18T10:00:00.000Z'),
  startedAt: new Date('2026-07-18T10:00:01.000Z'),
  finishedAt: new Date('2026-07-18T10:00:02.000Z'),
};

describe('toContextReceiptResponse', () => {
  it.each(['completed', 'failed', 'cancelled', 'expired'] as const)(
    'reports a terminal %s run with no receipt as not produced',
    (status) => {
      expect(toContextReceiptResponse({ ...run, status }, [])).toMatchObject({
        state: 'not_produced',
        receipts: [],
      });
    },
  );

  it('carries the effort the run resolved at accept time', () => {
    const response = toContextReceiptResponse({ ...run, effort: 'high' }, []);

    expect(response.effort).toBe('high');
  });
});
