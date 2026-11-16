import { Inject, Injectable } from '@nestjs/common';

import { MessagesRepository } from '../chats/messages-repository';
import {
  planOwnerCompaction,
  type OwnerCompactionPlan,
} from '../compaction/owner-compaction-plan';
import { errorMessageWithoutParams } from '../db/loggable-error';
import {
  RunExecutionService,
  type RunClaimResult,
} from './run-execution.service';
import { type RunJob } from './run-queues';
import {
  renderCompactionInstruction,
  type CompactionPlan,
} from '../compaction/compaction';
import {
  CompactionService,
  type CompactionSummary,
} from '../compaction/compaction.service';
import { createRunMediaResolver } from '../media/media-descriptors';
import { type ModelClient } from '../models/model-client';
import { TenantDbService } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';

@Injectable()
export class CompactionRunService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantDbService,
    @Inject(CompactionService)
    private readonly compaction: Pick<CompactionService, 'summarizeCheckpoint'>,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunExecutionService)
    private readonly execution: Pick<
      RunExecutionService,
      'claimRun' | 'completeCompactionRun' | 'settleTerminalRun'
    >,
  ) {}

  async execute(
    job: RunJob,
    client: ModelClient,
    abortSignal: AbortSignal,
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    },
  ): Promise<void> {
    const claim = await this.execution.claimRun({
      runId: job.runId,
      chatId: job.chatId,
      userId: job.userId,
      abortSignal,
      expectedQueueIdentity,
    });

    if ('settledReply' in claim || 'nativeRecovery' in claim) return;

    const { plan, nextSeq, activeCheckpoint } = await this.plan(job);

    if (plan === null) {
      await this.finish(job, claim.attemptId, undefined, expectedQueueIdentity);

      return;
    }

    const summary = await this.summarizeOrFail({
      job,
      client,
      claim,
      plan,
      nextSeq,
      activeCheckpoint,
      abortSignal,
      expectedQueueIdentity,
    });

    if (summary === undefined) return;

    await this.finish(job, claim.attemptId, summary, expectedQueueIdentity);
  }

  private async summarizeOrFail(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    plan: CompactionPlan;
    nextSeq: number;
    activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
  }): Promise<CompactionSummary | undefined> {
    try {
      const summary = await this.summarize(input);

      if (summary === null) {
        throw new Error('Compaction summary returned no valid text summary.');
      }

      return summary;
    } catch (error) {
      if (input.abortSignal.aborted) throw error;

      const message = errorMessageWithoutParams(error);

      await this.execution.settleTerminalRun({
        runId: input.job.runId,
        userId: input.job.userId,
        status: 'failed',
        attemptId: input.claim.attemptId,
        expectedQueueIdentity: input.expectedQueueIdentity,
        runPayload: { status: 'failed', message },
        error: { message },
      });

      return undefined;
    }
  }

  private async plan(job: RunJob): Promise<OwnerCompactionPlan> {
    return this.tenantDb.runAs(job.userId, (tx) =>
      planOwnerCompaction(new MessagesRepository(tx), job.chatId, job.userId),
    );
  }

  private async summarize(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    plan: CompactionPlan;
    nextSeq: number;
    activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
    abortSignal: AbortSignal;
  }): Promise<CompactionSummary | null> {
    return this.compaction.summarizeCheckpoint({
      variant: 'owner',
      chatId: input.job.chatId,
      userId: input.job.userId,
      triggeringUserSeq: input.nextSeq,
      plan: input.plan,
      previousCheckpoint: input.activeCheckpoint,
      client: input.client,
      reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
      abortSignal: input.abortSignal,
      media: createRunMediaResolver(this.tenantDb, input.job.userId),
      instruction: renderCompactionInstruction('owner'),
      ...(input.claim.effort !== undefined && { effort: input.claim.effort }),
    });
  }

  private async finish(
    job: RunJob,
    attemptId: string,
    summary: CompactionSummary | undefined,
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    },
  ): Promise<void> {
    await this.execution.completeCompactionRun({
      runId: job.runId,
      chatId: job.chatId,
      userId: job.userId,
      attemptId,
      expectedQueueIdentity,
      summary,
    });
  }
}
