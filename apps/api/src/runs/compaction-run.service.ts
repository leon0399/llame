import { Inject, Injectable } from '@nestjs/common';

import { MessagesRepository } from '../chats/messages-repository';
import {
  planOwnerCompaction,
  type OwnerCompactionPlan,
} from '../compaction/owner-compaction-plan';
import { errorMessageWithoutParams } from '../db/loggable-error';
import {
  classifyAbortedRun,
  expiredRunMessage,
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

    await this.runClaimed({
      job,
      client,
      abortSignal,
      expectedQueueIdentity,
      claim,
    });
  }

  private async runClaimed(input: {
    job: RunJob;
    client: ModelClient;
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
    claim: Extract<RunClaimResult, { messageId: string | null }>;
  }): Promise<void> {
    try {
      await this.summarizeAndFinish(input);
    } catch (error) {
      if (!input.abortSignal.aborted) throw error;

      const status = classifyAbortedRun(input.abortSignal);

      const message =
        status === 'expired'
          ? expiredRunMessage(input.abortSignal)
          : 'Run was cancelled.';

      await this.execution.settleTerminalRun({
        runId: input.job.runId,
        userId: input.job.userId,
        status,
        attemptId: input.claim.attemptId,
        expectedQueueIdentity: input.expectedQueueIdentity,
        runPayload: { status, message },
        error: { message },
      });
    }
  }

  private async summarizeAndFinish(input: {
    job: RunJob;
    client: ModelClient;
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
    claim: Extract<RunClaimResult, { messageId: string | null }>;
  }): Promise<void> {
    const { plan, nextSeq, activeCheckpoint } = await this.plan(input.job);

    if (plan === null) {
      await this.finish({
        job: input.job,
        attemptId: input.claim.attemptId,
        expectedQueueIdentity: input.expectedQueueIdentity,
        abortSignal: input.abortSignal,
      });

      return;
    }

    const summary = await this.summarizeOrFail({
      ...input,
      plan,
      nextSeq,
      activeCheckpoint,
    });

    if (summary === undefined) return;

    await this.finish({
      job: input.job,
      attemptId: input.claim.attemptId,
      summary,
      expectedQueueIdentity: input.expectedQueueIdentity,
      abortSignal: input.abortSignal,
    });
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

  private async finish(input: {
    job: RunJob;
    attemptId: string;
    summary?: CompactionSummary;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
    abortSignal: AbortSignal;
  }): Promise<void> {
    await this.execution.completeCompactionRun({
      runId: input.job.runId,
      chatId: input.job.chatId,
      userId: input.job.userId,
      attemptId: input.attemptId,
      expectedQueueIdentity: input.expectedQueueIdentity,
      summary: input.summary,
      abortSignal: input.abortSignal,
    });
  }
}
