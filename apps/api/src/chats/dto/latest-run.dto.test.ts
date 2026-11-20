import { type Run } from '../../db/schema';
import { toChatLatestRunResponse } from './latest-run.dto';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'turn',
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
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
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
      kind: 'turn',
      messageId: run.messageId,
      status: 'failed',
      followUpAction: null,
      modelId: 'system:test-model-a',
      effort: 'high',
      permissionMode: 'bypass',
      error: null,
      errorCode: null,
      errorResetsAt: null,
      quotaWait: null,
    });
  });

  it('reports the recorded message of a failed or expired Run as the error', () => {
    const error = { message: 'This model is unavailable for free.' };

    expect(toChatLatestRunResponse({ ...run, error }).error).toBe(
      'This model is unavailable for free.',
    );
    expect(
      toChatLatestRunResponse({ ...run, status: 'expired', error }).error,
    ).toBe('This model is unavailable for free.');
  });

  it('reports no error for a cancelled or completed Run, whose stream sends none', () => {
    const error = { message: 'Cancelled.' };

    expect(
      toChatLatestRunResponse({ ...run, status: 'cancelled', error }).error,
    ).toBeNull();
    expect(
      toChatLatestRunResponse({ ...run, status: 'completed', error }).error,
    ).toBeNull();
  });

  it('reports null when the recorded error carries no message', () => {
    expect(toChatLatestRunResponse({ ...run, error: {} }).error).toBeNull();
    expect(
      toChatLatestRunResponse({ ...run, error: 'not-a-record' }).error,
    ).toBeNull();
    expect(toChatLatestRunResponse({ ...run, error: [] }).error).toBeNull();
  });

  it('projects failed error code and reset metadata without narrowing codes', () => {
    expect(
      toChatLatestRunResponse({
        ...run,
        error: {
          message: 'failed',
          code: 'context_incompatible',
          resetsAt: 1_900_000_000_000,
          provider: 'private',
        },
      }),
    ).toMatchObject({
      error: 'failed',
      errorCode: 'context_incompatible',
      errorResetsAt: 1_900_000_000_000,
    });
    expect(
      toChatLatestRunResponse({
        ...run,
        error: { code: 'quota_exhausted', resetsAt: Number.POSITIVE_INFINITY },
      }),
    ).toMatchObject({ errorCode: 'quota_exhausted', errorResetsAt: null });
    expect(
      toChatLatestRunResponse({
        ...run,
        status: 'expired',
        error: { code: 'provider_private', resetsAt: 1_900_000_000_000 },
      }),
    ).toMatchObject({ errorCode: null, errorResetsAt: null });
  });
});
