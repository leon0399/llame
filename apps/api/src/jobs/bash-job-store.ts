import { eq } from 'drizzle-orm';
import { type ManagedOutput } from '@workspace/bash-executor';

import { chatJobChunks, chatJobs, type ChatJob } from '../db/schema';
import { pgErrorCode } from '../db/pg-error';
import { ChatsRepository } from '../chats/chats-repository';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { commitArtifactInTransaction } from '../tools/artifacts/artifact-writer';
import { writeArtifactHostFiles } from '../tools/artifacts/host-files';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { recordJobSettlementNotice } from './job-notices';
import { type NewArtifactPart } from '../tools/artifacts/artifacts-repository';
import { type JobNoticeRunService } from '../runs/job-notice-run.service';
import { retryRunTransaction } from '../runs/run-transaction';

type JobCompletion = {
  readonly output: ManagedOutput;
  readonly settlement: JobSettlement;
  readonly offsets: Readonly<Record<'stdout' | 'stderr', number>>;
};

type JobArtifact = {
  id: string;
  createdAt: Date;
  parts: Array<NewArtifactPart>;
};

export type JobSettlementContext = {
  readonly maxBytes: number;
  readonly hostFiles: boolean;
  readonly noticeRuns: Pick<JobNoticeRunService, 'startOnSettlement'>;
};

const OUTPUTS = ['stdout', 'stderr'] as const;

/** Appends only the suffix not already committed; offsets move after commit. */
export async function appendJobOutput(
  db: Db,
  job: ChatJob,
  output: ManagedOutput,
  offsets: Readonly<Record<'stdout' | 'stderr', number>>,
): Promise<void> {
  for (const name of OUTPUTS) {
    const content = output[name].slice(offsets[name]);

    if (content === '') continue;
    await db.insert(chatJobChunks).values({
      jobId: job.id,
      ownerUserId: job.ownerUserId,
      output: name,
      position: offsets[name],
      content: Buffer.from(content),
    });
  }
}

/** Chat first, then job: settlement uses the same fence as admission (D6). */
export async function settleBashJob(
  tenantDb: TenantRunner,
  job: ChatJob,
  completion: JobCompletion,
  context: JobSettlementContext,
): Promise<void> {
  const artifact = await retryRunTransaction(() =>
    tenantDb.runAs(job.ownerUserId, (tx) =>
      settleInTransaction(tx, job, completion, context),
    ),
  );

  if (artifact !== undefined && context.hostFiles) {
    await writeArtifactHostFiles({
      chatId: job.chatId,
      toolName: 'bash',
      seq: job.seq,
      createdAt: artifact.createdAt,
      parts: artifact.parts,
    });
  }
}

async function settleInTransaction(
  tx: Db,
  job: ChatJob,
  completion: JobCompletion,
  context: JobSettlementContext,
): Promise<JobArtifact | undefined> {
  // Chat first (D6); `settle` then locks the job row and only moves a running one.
  if (
    (await new ChatsRepository(tx).lock(job.chatId, job.ownerUserId)) ===
    undefined
  )
    return undefined;

  const settled = await new ChatJobsRepository(tx).settle(
    job.chatId,
    job.ownerUserId,
    job.id,
    completion.settlement,
  );

  if (settled === undefined) return undefined;
  await appendJobOutput(tx, job, completion.output, completion.offsets);

  let artifact: JobArtifact | undefined;

  if (
    job.artifactReadable &&
    OUTPUTS.some((name) => completion.output[name].length > 2000)
  ) {
    try {
      artifact = await writeJobArtifact(tx, job, completion, context.maxBytes);
    } catch (error) {
      // Deadlocks/serialization failures must retry the whole transaction.
      if (isRetryableJobError(error)) throw error;
    }
  }

  await recordJobSettlementNotice(tx, settled);
  await context.noticeRuns.startOnSettlement(tx, settled);

  return artifact;
}

function writeJobArtifact(
  tx: Db,
  job: ChatJob,
  completion: JobCompletion,
  maxBytes: number,
): Promise<JobArtifact> {
  const request = {
    chatId: job.chatId,
    userId: job.ownerUserId,
    runId: job.runId,
    toolCallId: job.toolCallId,
    toolName: 'bash',
    complete:
      completion.settlement.state !== 'lost' && !completion.output.truncated,
    parts: OUTPUTS.map((name) => ({
      name,
      contentType: 'text/plain',
      content: Buffer.from(completion.output[name]),
    })),
  };

  return tx.transaction(async (savepoint) => {
    const written = await commitArtifactInTransaction(
      savepoint,
      request,
      job.seq,
      maxBytes,
    );

    await savepoint
      .update(chatJobs)
      .set({ artifactId: written.id })
      .where(eq(chatJobs.id, job.id));
    await savepoint
      .delete(chatJobChunks)
      .where(eq(chatJobChunks.jobId, job.id));

    return written;
  });
}

function isRetryableJobError(error: unknown): boolean {
  const code = pgErrorCode(error);

  return code === '40P01' || code === '40001';
}
