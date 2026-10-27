import { type Run } from '../../db/schema';
import { toChatLatestRunResponse } from './latest-run.dto';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  chatId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  userId: 'owner',
  modelId: 'system:test-model-a',
  status: 'failed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: new Date('2026-10-27T10:00:00.000Z'),
  startedAt: new Date('2026-10-27T10:00:01.000Z'),
  finishedAt: new Date('2026-10-27T10:00:02.000Z'),
  effort: 'high',
  permissionMode: 'bypass',
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  followUpAction: null,
  sourceRunId: null,
};

describe('toChatLatestRunResponse', () => {
  it('reports the Run settings the follow-up actions judge', () => {
    expect(toChatLatestRunResponse(run)).toEqual({
      id: run.id,
      messageId: run.messageId,
      status: 'failed',
      followUpAction: null,
      modelId: 'system:test-model-a',
      effort: 'high',
      permissionMode: 'bypass',
      error: null,
    });
  });

  it('reports the recorded failure message as the error', () => {
    const failed: Run = {
      ...run,
      error: { message: 'This model is unavailable for free.' },
    };

    expect(toChatLatestRunResponse(failed).error).toBe(
      'This model is unavailable for free.',
    );
  });

  it('reports null when the recorded error carries no message', () => {
    expect(toChatLatestRunResponse({ ...run, error: {} }).error).toBeNull();
    expect(
      toChatLatestRunResponse({ ...run, error: 'not-a-record' }).error,
    ).toBeNull();
    expect(toChatLatestRunResponse({ ...run, error: [] }).error).toBeNull();
  });
});
