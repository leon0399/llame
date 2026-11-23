import { describe, expect, it } from 'vitest';

import { type Run } from '../../db/schema';
import {
  attemptModelSelections,
  toContextReceiptResponse,
  toRunResponse,
} from './runs.dto';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'turn',
  chatId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  userId: 'owner',
  selector: 'system:openai:public-model',
  modelId: 'system:openai:public-model',
  selectedEffort: null,
  selectionRevision: 1,
  effort: null,
  permissionMode: 'default' as const,
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: new Date('2026-07-18T10:00:00.000Z'),
  startedAt: new Date('2026-07-18T10:00:01.000Z'),
  finishedAt: new Date('2026-07-18T10:00:02.000Z'),
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
  followUpAction: null,
  sourceRunId: null,
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

  it('reports the selector the Run recorded beside the served model', () => {
    const response = toRunResponse(run);

    expect(response.selector).toBe('system:openai:public-model');
    expect(response.modelId).toBe('system:openai:public-model');
    expect(response).not.toHaveProperty('selectionRevision');
    expect(response).not.toHaveProperty('selectedEffort');
  });

  it('carries the effort the run resolved at accept time', () => {
    const response = toContextReceiptResponse({ ...run, effort: 'high' }, []);

    expect(response.effort).toBe('high');
  });

  const receipt = {
    attemptId: '66666666-6666-4666-8666-666666666666',
    source: 'model_override' as const,
    systemPrompt: 'Complete effective prompt',
    promptHash: 'prompt-hash',
    createdAt: new Date('2026-07-18T09:59:59.000Z'),
  };

  it("reads each attempt's requested model from its model.requested event", () => {
    expect(
      attemptModelSelections([
        { payload: { modelId: 'model-a', attemptId: 'a1', effort: 'high' } },
        { payload: { modelId: 'model-b', attemptId: 'b2' } },
        // A payload without both identities contributes nothing.
        { payload: { modelId: 'model-c' } },
        { payload: null },
      ]),
    ).toEqual([
      { attemptId: 'a1', modelId: 'model-a', effort: 'high' },
      { attemptId: 'b2', modelId: 'model-b' },
    ]);
  });

  it('labels each attempt receipt with the model that attempt requested', () => {
    const response = toContextReceiptResponse(
      { ...run, activeAttemptId: receipt.attemptId },
      [receipt],
      [
        {
          attemptId: receipt.attemptId,
          modelId: 'custom:anthropic:sonnet',
          effort: 'high',
        },
      ],
    );

    expect(response.modelId).toBe(run.modelId);
    expect(response.receipts[0]).toMatchObject({
      modelId: 'custom:anthropic:sonnet',
      effort: 'high',
    });
  });

  it("falls back to the Run's model when an attempt recorded no request", () => {
    const response = toContextReceiptResponse(run, [receipt], []);

    expect(response.receipts[0]?.modelId).toBe(run.modelId);
    expect(response.receipts[0]).not.toHaveProperty('effort');
  });

  it('includes the accepted bypass mode on both response shapes', () => {
    const bypassRun = { ...run, permissionMode: 'bypass' as const };

    expect(toRunResponse(bypassRun).permissionMode).toBe('bypass');
    expect(toContextReceiptResponse(bypassRun, []).permissionMode).toBe(
      'bypass',
    );
  });

  it('includes only the public quota wait fields on an awaiting Run', () => {
    const response = toRunResponse({
      ...run,
      status: 'awaiting_quota',
      awaiting: {
        kind: 'quota',
        failureClass: 'quota_exhausted',
        resetsAt: '2026-11-20T12:00:00.000Z',
        wakeAt: '2026-11-20T12:01:00.000Z',
        resumeAt: 'request',
        waitCount: 2,
      },
    });

    expect(response.quotaWait).toEqual({
      failureClass: 'quota_exhausted',
      resetsAt: '2026-11-20T12:00:00.000Z',
      wakeAt: '2026-11-20T12:01:00.000Z',
    });
    expect(response).not.toHaveProperty('resumeAt');
    expect(response).not.toHaveProperty('waitCount');
  });
});
