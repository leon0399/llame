import { and, desc, eq, inArray } from 'drizzle-orm';
import { isRecord, type ToolResult } from '@workspace/runtime-safety';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import {
  chatJobs,
  runEvents,
  runs,
  type AwaitingJobs,
  type ChatJob,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { isTerminalRunStatus } from './run-status';
import { buildWaitResult } from '../tools/wait';

export async function completeWaitInTransaction(
  tx: Db,
  run: Run,
  request: Pick<AwaitingJobs, 'toolCallId' | 'jobIds'>,
  cause: 'settled' | 'interrupted' | 'timeout',
): Promise<ToolResult> {
  const attemptId = run.activeAttemptId;

  if (
    attemptId === null ||
    isTerminalRunStatus(run.status) ||
    run.finishedAt !== null
  )
    throw new Error('A wait result requires its active Run attempt.');

  const rows = await readWaitJobs(tx, run, request.jobIds);

  const output = await buildWaitResult(tx, run, rows, cause);

  const fenced = await new RunsRepository(tx).updateForAttempt(
    run.id,
    run.userId,
    attemptId,
    { awaiting: null },
  );

  if (!fenced || fenced.cancelRequestedAt !== null)
    throw new Error('The resumed wait lost its active attempt.');

  const consumedJobNoticeIds = await new ChatDeliveriesRepository(
    tx,
  ).consumeJobNotices({
    chatId: run.chatId,
    ownerUserId: run.userId,
    runId: run.id,
    jobIds: rows.filter((job) => job.state !== 'running').map((job) => job.id),
  });

  await new RunEventsRepository(tx).append(run.id, 'tool.completed', {
    toolCallId: request.toolCallId,
    toolName: 'wait',
    status: output.status,
    output,
    consumedJobNoticeIds,
  });

  return output;
}

async function readWaitJobs(
  tx: Db,
  run: Run,
  jobIds: Array<string>,
): Promise<Array<ChatJob>> {
  const stored = await tx
    .select()
    .from(chatJobs)
    .where(
      and(
        eq(chatJobs.chatId, run.chatId),
        eq(chatJobs.ownerUserId, run.userId),
        inArray(chatJobs.id, jobIds),
      ),
    );

  const byId = new Map(stored.map((job) => [job.id, job]));

  return jobIds.map((id) => {
    const job = byId.get(id);

    if (job === undefined)
      throw new Error('A resumed wait no longer owns its listed job.');

    return job;
  });
}

export async function pendingWakeInTransaction(
  tx: Db,
  run: Run,
): Promise<'settled' | 'interrupted' | 'timeout' | undefined> {
  if (run.awaiting === null) return undefined;

  const [latest] = await tx
    .select({
      eventType: runEvents.eventType,
      payload: runEvents.payload,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runs.id, runEvents.runId))
    .where(
      and(
        eq(runs.id, run.id),
        eq(runs.userId, run.userId),
        inArray(runEvents.eventType, [
          'run.resumed',
          'run.started',
          'run.delivered',
        ]),
      ),
    )
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  if (latest?.eventType !== 'run.resumed') return undefined;

  const payload = latest.payload;

  if (!isRecord(payload) || payload['generation'] !== run.wakeGeneration)
    throw new Error('The current Run wake receipt is invalid.');

  const cause = payload['cause'];

  if (cause === 'settled' || cause === 'interrupted' || cause === 'timeout')
    return cause;

  throw new Error('The current Run wake cause is invalid.');
}
