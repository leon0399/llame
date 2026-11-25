import { eq } from 'drizzle-orm';
import { type ManagedOutput } from '@workspace/bash-executor';

import { chatJobs, type ChatJob } from '../db/schema';
import { ChatsRepository } from '../chats/chats-repository';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { commitArtifactInTransaction } from '../tools/artifacts/artifact-writer';
import { writeArtifactHostFiles } from '../tools/artifacts/host-files';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { recordJobSettlementNotice } from './job-notices';
import { type NewArtifactPart } from '../tools/artifacts/artifacts-repository';
import { type JobNoticeRunService } from '../runs/job-notice-run.service';
import { type RunWaitService } from '../runs/run-wait.service';
import { retryRunTransaction } from '../runs/run-transaction';

type JobCompletion = {
  readonly output: ManagedOutput | null;
  readonly settlement: JobSettlement;
};

type JobArtifact = {
  id: string;
  createdAt: Date;
  parts: Array<NewArtifactPart>;
};

export type JobSettlementContext = {
  readonly maxBytes: number;
  readonly hostFiles: boolean;
  readonly backgrounded?: boolean;
  readonly noticeRuns: Pick<JobNoticeRunService, 'startOnSettlement'>;
  readonly wake: Pick<RunWaitService, 'wakeForChatInTransaction'>;
};
const OUTPUTS = ['stdout', 'stderr'] as const;

/** Settle once and keep the one bounded artifact copy for every job. */
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
      toolName: job.kind,
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

  const output = completion.output;
  const artifact =
    output === null
      ? undefined
      : await writeJobArtifact(
          tx,
          job,
          { ...completion, output },
          context.maxBytes,
        );

  if (context.backgrounded !== false) {
    await recordJobSettlementNotice(tx, settled);
    await context.noticeRuns.startOnSettlement(tx, settled);
  }
  await context.wake.wakeForChatInTransaction(tx, {
    chatId: settled.chatId,
    userId: settled.ownerUserId,
    jobId: settled.id,
    kind: 'settlement',
  });
  return artifact;
}

function writeJobArtifact(
  tx: Db,
  job: ChatJob,
  completion: JobCompletion & { readonly output: ManagedOutput },
  maxBytes: number,
): Promise<JobArtifact> {
  const request = {
    chatId: job.chatId,
    userId: job.ownerUserId,
    runId: job.runId,
    toolCallId: job.toolCallId,
    toolName: job.kind,
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
    return written;
  });
}
