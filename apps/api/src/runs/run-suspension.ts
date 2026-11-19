import { randomUUID } from 'node:crypto';
import type { RunDispatchService } from './run-dispatch.service';
import { MessagesRepository } from '../chats/chats-repository';
import { toRunUserMessage } from '../chats/chat-message-parts';
import type { AwaitingJobs, AwaitingQuota, Run } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import type { EnqueueOptions } from '../queue/queue';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import type {
  SuspendRunQuotaInput,
  SuspendRunWaitInput,
} from './run-wait.service';

type SuspensionCheckpointInput =
  | {
      kind: 'jobs';
      input: SuspendRunWaitInput;
      awaiting: AwaitingJobs;
      deadline: string;
    }
  | {
      kind: 'quota';
      input: SuspendRunQuotaInput;
      awaiting: AwaitingQuota;
      deadline: string;
    };

export async function persistRunSuspension(
  tx: Db,
  dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
  run: Run,
  data: SuspensionCheckpointInput,
): Promise<boolean> {
  const { input, awaiting } = data;
  const generation = run.wakeGeneration + 1;
  const jobId = randomUUID();

  const updated = await new RunsRepository(tx).updateForAttempt(
    run.id,
    input.userId,
    input.attemptId,
    {
      status: data.kind === 'quota' ? 'awaiting_quota' : 'awaiting_jobs',
      awaiting,
      wakeGeneration: generation,
      currentJobId: jobId,
      activeAttemptId: null,
    },
  );

  if (!updated) return false;
  await appendSuspensionEvents(tx, run, data, generation);
  await enqueueSuspendedRun(tx, dispatch, {
    run,
    userId: input.userId,
    generation,
    jobId,
    deadline: data.deadline,
  });

  return true;
}

export async function enqueueSuspendedRun(
  tx: Db,
  dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
  data: {
    run: Run;
    userId: string;
    generation: number;
    jobId: string;
    deadline?: string;
  },
): Promise<void> {
  const { run, userId, generation, jobId } = data;

  const message =
    run.messageId === null
      ? undefined
      : await new MessagesRepository(tx).findById(
          run.chatId,
          userId,
          run.messageId,
        );

  if (!message && !(run.kind === 'compaction' && run.messageId === null))
    throw new Error(`Run ${run.id} has no triggering message`);
  const options: Omit<EnqueueOptions, 'tx'> = { id: jobId };

  if (data.deadline !== undefined) options.startAfter = new Date(data.deadline);
  await dispatch.enqueueInTransaction(
    tx,
    {
      runId: run.id,
      chatId: run.chatId,
      userId: run.userId,
      modelId: run.modelId,
      ...(message && { userMessage: toRunUserMessage(message) }),
      wake: { generation, jobId },
    },
    options,
  );
}

async function appendSuspensionEvents(
  tx: Db,
  run: Run,
  data: SuspensionCheckpointInput,
  generation: number,
): Promise<void> {
  const events = new RunEventsRepository(tx);

  const { kind, input, awaiting } = data;

  if (kind === 'quota') {
    await events.append(
      run.id,
      'run.suspended',
      quotaSuspensionPayload(input, awaiting, generation),
    );
  } else {
    if (input.telemetry !== undefined)
      await events.append(run.id, 'model.completed', {
        finishReason: input.telemetry.finishReason,
        telemetry: input.telemetry,
      });
    await events.append(run.id, 'run.suspended', {
      attemptId: input.attemptId,
      generation,
      toolCallId: input.toolCallId,
      parts: input.parts,
      steps: input.steps,
      awaiting,
    });
  }
}

function quotaSuspensionPayload(
  input: SuspendRunQuotaInput,
  awaiting: AwaitingQuota,
  generation: number,
) {
  return {
    kind: 'quota',
    attemptId: input.attemptId,
    generation,
    failureClass: awaiting.failureClass,
    resetsAt: awaiting.resetsAt,
    wakeAt: awaiting.wakeAt,
    resumeAt: awaiting.resumeAt,
    waitCount: awaiting.waitCount,
    parts: input.parts,
    steps: input.steps,
    ...(input.stoppedCalls !== undefined && {
      stoppedCalls: input.stoppedCalls,
    }),
    ...(input.stepBudgetUsed !== undefined && {
      stepBudgetUsed: input.stepBudgetUsed,
    }),
    ...(input.boundaryMode !== undefined && {
      boundaryMode: input.boundaryMode,
    }),
    ...(input.summaryAttemptId !== undefined && {
      summaryAttemptId: input.summaryAttemptId,
    }),
    ...(input.summaryPrefixFingerprint !== undefined && {
      summaryPrefixFingerprint: input.summaryPrefixFingerprint,
    }),
    ...(input.baselines !== undefined && { baselines: input.baselines }),
  };
}
