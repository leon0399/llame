/**
 * The single-flight part of admission (durable-runs): what counts as a live
 * blocking Run, and the bounded job-state read that decides it. The stuck-Run
 * expiry itself is covered by the follow-up integration suite; these are the
 * branches that pick between 409 and expiry.
 */

import { ConflictException } from '@nestjs/common';

import { type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type JobState } from '../queue/queue';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { asDouble } from '../testing/support';
import { clearActiveRunSlot } from './chat-admission';

const now = new Date('2026-10-27T00:00:00.000Z');

const blockingRun: Run = {
  id: 'run-blocking',
  chatId: 'chat-id',
  messageId: 'message-id',
  userId: 'user-id',
  modelId: 'system:openai:gpt-5.4-mini',
  status: 'running_model',
  workerId: 'worker-1',
  activeAttemptId: 'attempt-1',
  completedAttemptId: null,
  turnToolAvailability: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: now,
  startedAt: now,
  finishedAt: null,
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

function makeApi(state: JobState) {
  // Every repository call is prototype-spied; the transaction handle only has
  // to exist for `new RunsRepository(tx)` / `new RunEventsRepository(tx)`.
  const tx = asDouble<Db>({});
  const jobState = vi.fn<RunDispatcher['jobState']>(() =>
    Promise.resolve(state),
  );
  const findActiveByChatId = vi
    .spyOn(RunsRepository.prototype, 'findActiveByChatId')
    .mockResolvedValue(blockingRun);
  const markFinished = vi.spyOn(RunsRepository.prototype, 'markFinished');
  const append = vi.spyOn(RunEventsRepository.prototype, 'append');
  const instanceConfig: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };
  const dispatch: Pick<RunDispatcher, 'jobState'> = { jobState };

  const slot = {
    tx,
    chatId: blockingRun.chatId,
    userId: blockingRun.userId,
    dispatch,
    instanceConfig,
  };

  return { slot, jobState, findActiveByChatId, markFinished, append };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('clearActiveRunSlot', () => {
  it('refuses the Chat while the blocking Run’s job is retrying', async () => {
    const { slot, markFinished } = makeApi('retrying');

    await expect(clearActiveRunSlot(slot)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Another run is already in flight for this chat',
    });
    expect(markFinished).not.toHaveBeenCalled();
  });

  it('clears the job-state read timeout once the state arrives', async () => {
    vi.useFakeTimers();
    const { slot } = makeApi('active');

    // The live state still refuses the Chat, but the bounded wait that
    // produced it must not leave its timer behind.
    await expect(clearActiveRunSlot(slot)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
