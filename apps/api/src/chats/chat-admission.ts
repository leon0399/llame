/**
 * The single-flight part of a chat send's admission (durable-runs), shared by
 * every path that adds a Run to a Chat — a new message and a follow-up
 * request. The caller already holds the Chat's row lock; this module judges
 * the blocking Run and expires one the queue can no longer execute.
 */

import { ConflictException } from '@nestjs/common';

import { type RunWaitService } from '../runs/run-wait.service';
import { type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { finalizeRunReply } from '../runs/run-reply-finalizer';
import { heartbeatSeconds } from '../runs/run-queues';
import { notifyRunControl } from '../runs/run-control';
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
async function blockerIsLive(input: {
  dispatch: Pick<RunDispatcher, 'jobState'>;
  instanceConfig: InstanceConfigReader;
  run: Run;
}): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  const jobId = input.run.currentJobId ?? input.run.id;

  const state = await Promise.race([
    input.dispatch.jobState(jobId),
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

  // A recorded wake/deadline job exists from the transaction that records
  // it. Only the initial run.id job receives the existing heartbeat grace.
  if (input.run.currentJobId !== null) return false;

  const lastSignOfLife = input.run.startedAt ?? input.run.createdAt;

  return (
    Date.now() - lastSignOfLife.getTime() <
    heartbeatSeconds(input.instanceConfig.config) * 1000
  );
}

type ActiveRunSlotInput = {
  tx: Db;
  chatId: string;
  userId: string;
  dispatch: Pick<RunDispatcher, 'jobState'>;
  instanceConfig: InstanceConfigReader;
};

/**
 * Judge the Chat's single-flight slot for the Run this transaction is about to
 * create: `blocked` while a live Run holds it, `free` otherwise. A stuck Run
 * is expired with a terminal `run.expired` first, so the request that found it
 * can proceed.
 */
export async function claimActiveRunSlot(
  input: ActiveRunSlotInput,
): Promise<'free' | 'blocked'> {
  const runsRepo = new RunsRepository(input.tx);
  const eventsRepo = new RunEventsRepository(input.tx);

  const findActive = () =>
    runsRepo.findActiveByChatId(input.chatId, input.userId);

  const blocking = await findActive();

  if (!blocking) return 'free';

  if (await blockerIsLive({ ...input, run: blocking })) {
    // Re-check the row once: `blocking` may have finished between the read
    // above and now, in which case the chat is simply free. Its job state
    // is not read again, so one request holds the chat row for at most one
    // bounded wait.
    return (await findActive()) ? 'blocked' : 'free';
  }

  const message =
    'Expired by a new request: run stuck with no execution progress.';

  const expired = await runsRepo.markFinished(
    blocking.id,
    input.userId,
    'expired',
    { error: { message } },
  );

  if (!expired) return 'free';
  // The chat row is held first and the run row next, so finalizing the reply
  // after them keeps the worker's run-then-reply order.
  await finalizeRunReply(input.tx, {
    run: expired,
    status: 'expired',
    models: input.instanceConfig.config.models,
  });
  await eventsRepo.append(blocking.id, 'run.expired', {
    status: 'expired',
    message,
  });

  return 'free';
}

/**
 * Free the Chat's single-flight slot for the Run this transaction is about to
 * create: a live Run answers 409, and a stuck one is expired first. A caller
 * that can store the message another way uses `claimActiveRunSlot`.
 */
export async function clearActiveRunSlot(
  input: ActiveRunSlotInput,
): Promise<void> {
  if ((await claimActiveRunSlot(input)) === 'blocked') {
    throw new ConflictException(
      'Another run is already in flight for this chat',
    );
  }
}

/**
 * Tells the process that executes the Chat's live Run about a pending `steer`
 * or `interrupt` item. Called in the transaction that stores or changes the
 * item, so the pointer is delivered on commit only; the listener confirms the
 * item itself (run-steering D6).
 */
export async function notifyLiveRunSteering(
  tx: Db,
  chat: { chatId: string; userId: string },
  kind: 'steer' | 'interrupt',
  runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
): Promise<void> {
  const live = await new RunsRepository(tx).findActiveByChatId(
    chat.chatId,
    chat.userId,
  );

  if (!live) return;

  if (live.status === 'awaiting_jobs') {
    await runWait.wakeForChatInTransaction(tx, {
      chatId: chat.chatId,
      userId: chat.userId,
      kind,
    });

    return;
  }

  await notifyRunControl(tx, { runId: live.id, kind });
}
