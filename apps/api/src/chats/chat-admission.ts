/**
 * The single-flight part of a chat send's admission (durable-runs), shared by
 * every path that adds a Run to a Chat — a new message and a follow-up
 * request. The caller already holds the Chat's row lock; this module judges
 * the blocking Run and expires one the queue can no longer execute.
 */

import { ConflictException } from '@nestjs/common';

import { type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { finalizeRunReply } from '../runs/run-reply-finalizer';
import { heartbeatSeconds } from '../runs/run-queues';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

/** How long admission waits on the blocking run's job state. */
const JOB_STATE_READ_TIMEOUT_MS = 5000;

/**
 * Whether a run still in flight is one the queue can execute, judged by its
 * own job's state rather than by its age: a queued, retrying, or active job
 * is live however long the run has existed. A job-less run is still treated
 * as live for one liveness window, because the enqueue can legitimately
 * land just after the run row committed. Anything else — absent and older
 * than that, or a settled job — means the queue can no longer execute it.
 *
 * The read runs inside the admission transaction, which holds the chat row,
 * so it is bounded; a state it cannot read in time, or at all, cannot prove
 * the run wedged and counts as live (409), never as expirable.
 */
export async function blockerIsLive(input: {
  dispatch: Pick<RunDispatcher, 'jobState'>;
  instanceConfig: InstanceConfigReader;
  run: Run;
}): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const state = await Promise.race([
    input.dispatch.jobState(input.run.id),
    new Promise<'unreadable'>((resolve) => {
      timer = setTimeout(
        () => resolve('unreadable'),
        JOB_STATE_READ_TIMEOUT_MS,
      );
    }),
  ])
    .catch(() => 'unreadable' as const)
    .finally(() => clearTimeout(timer));
  if (state !== 'absent') {
    return (
      state === 'unreadable' ||
      state === 'queued' ||
      state === 'retrying' ||
      state === 'active'
    );
  }
  const lastSignOfLife = input.run.startedAt ?? input.run.createdAt;
  return (
    Date.now() - lastSignOfLife.getTime() <
    heartbeatSeconds(input.instanceConfig.config) * 1000
  );
}

/**
 * Free the Chat's single-flight slot for the Run this transaction is about to
 * create: a live Run answers 409, and a stuck one is expired with a terminal
 * `run.expired` so the request that found it can proceed.
 */
export async function clearActiveRunSlot(input: {
  tx: Db;
  runsRepo: RunsRepository;
  eventsRepo: RunEventsRepository;
  chatId: string;
  userId: string;
  dispatch: Pick<RunDispatcher, 'jobState'>;
  instanceConfig: InstanceConfigReader;
}): Promise<void> {
  const findActive = () =>
    input.runsRepo.findActiveByChatId(input.chatId, input.userId);
  const blocking = await findActive();
  if (!blocking) return;
  if (await blockerIsLive({ ...input, run: blocking })) {
    // Re-check the row once: `blocking` may have finished between the read
    // above and now, in which case the chat is simply free. Its job state
    // is not read again, so one request holds the chat row for at most one
    // bounded wait.
    if (await findActive()) {
      throw new ConflictException(
        'Another run is already in flight for this chat',
      );
    }
    return;
  }

  await expireStuckRun(input, blocking);
}

/**
 * Expire a Run the queue can no longer execute, with a terminal `run.expired`
 * and a finalized reply, so the Chat's single-flight slot is free.
 */
async function expireStuckRun(
  input: {
    tx: Db;
    runsRepo: RunsRepository;
    eventsRepo: RunEventsRepository;
    userId: string;
    instanceConfig: InstanceConfigReader;
  },
  blocking: Run,
): Promise<void> {
  const message =
    'Expired by a new message: run stuck with no execution progress.';
  const expired = await input.runsRepo.markFinished(
    blocking.id,
    input.userId,
    'expired',
    { error: { message } },
  );
  if (!expired) return;
  // The chat row is held first and the run row next, so finalizing the reply
  // after them keeps the worker's run-then-reply order.
  await finalizeRunReply(input.tx, {
    run: expired,
    status: 'expired',
    models: input.instanceConfig.config.models,
  });
  await input.eventsRepo.append(blocking.id, 'run.expired', {
    status: 'expired',
    message,
  });
}
