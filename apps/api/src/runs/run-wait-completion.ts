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
  type RunEvent,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type RunWaitCause } from './run-wait.service';
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
    jobIds: rows.flatMap((job) => (job.state === 'running' ? [] : [job.id])),
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

export async function clearQuotaAwaitingInTransaction(
  tx: Db,
  run: Run,
  cause: RunWaitCause,
): Promise<void> {
  if (cause !== 'timeout' && cause !== 'cancelled')
    throw new Error('A quota wait cannot resume for this cause.');
  const attemptId = run.activeAttemptId;

  if (
    attemptId === null ||
    isTerminalRunStatus(run.status) ||
    run.finishedAt !== null
  )
    throw new Error('A wait result requires its active Run attempt.');

  const fenced = await new RunsRepository(tx).updateForAttempt(
    run.id,
    run.userId,
    attemptId,
    { awaiting: null },
  );

  if (
    !fenced ||
    (cause === 'cancelled'
      ? fenced.cancelRequestedAt === null
      : fenced.cancelRequestedAt !== null)
  )
    throw new Error('The resumed quota wait lost its active attempt.');
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
): Promise<'settled' | 'interrupted' | 'timeout' | 'cancelled' | undefined> {
  if (run.awaiting === null) return undefined;

  const receipt = await latestWakeReceipt(tx, run);

  return wakeCauseFromReceipt(run, receipt);
}

async function latestWakeReceipt(
  tx: Db,
  run: Run,
): Promise<Pick<RunEvent, 'eventType' | 'payload'> | undefined> {
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

  return latest;
}

function wakeCauseFromReceipt(
  run: Run,
  latest: Pick<RunEvent, 'eventType' | 'payload'> | undefined,
): 'settled' | 'interrupted' | 'timeout' | 'cancelled' | undefined {
  if (latest?.eventType !== 'run.resumed') return undefined;

  const payload = latest.payload;

  if (!isRecord(payload) || payload['generation'] !== run.wakeGeneration)
    throw new Error('The current Run wake receipt is invalid.');

  const kind = payload['kind'];

  if (
    (run.awaiting?.kind === 'quota' && kind !== 'quota') ||
    (run.awaiting?.kind === 'jobs' && kind !== undefined && kind !== 'jobs')
  )
    throw new Error('The current Run wake kind is invalid.');

  const cause = payload['cause'];

  if (
    cause === 'settled' ||
    cause === 'interrupted' ||
    cause === 'timeout' ||
    (run.awaiting?.kind === 'quota' && cause === 'cancelled')
  )
    return cause;

  throw new Error('The current Run wake cause is invalid.');
}
