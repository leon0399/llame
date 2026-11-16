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
import { readCreatedFlags } from './run-created-flags';
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

    await this.finishClaim({
      job,
      client,
      claim,
      abortSignal,
      expectedQueueIdentity,
    });
  }

  private async finishClaim(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
  }): Promise<void> {
    try {
      await this.completePlanned(input);
    } catch (error) {
      if (!input.abortSignal.aborted) throw error;

      await this.settleAborted(input);
    }
  }

  private async completePlanned(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
  }): Promise<void> {
    const { plan, nextSeq, activeCheckpoint, focus } = await this.plan(
      input.job,
    );

    if (plan === null) {
      await this.finishWithoutSummary(input, focus);

      return;
    }

    const summary = await this.summarizeOrFail({
      ...input,
      plan,
      nextSeq,
      activeCheckpoint,
      focus,
    });

    if (summary === undefined) return;

    await this.finish({
      job: input.job,
      attemptId: input.claim.attemptId,
      summary,
      expectedQueueIdentity: input.expectedQueueIdentity,
      focus,
      abortSignal: input.abortSignal,
    });
  }
  private async finishWithoutSummary(
    input: {
      job: RunJob;
      claim: Extract<RunClaimResult, { messageId: string | null }>;
      abortSignal: AbortSignal;
      expectedQueueIdentity: {
        currentJobId: string | null;
        wakeGeneration: number;
      };
    },
    focus: string | null,
  ): Promise<void> {
    await this.finish({
      job: input.job,
      attemptId: input.claim.attemptId,
      summary: undefined,
      expectedQueueIdentity: input.expectedQueueIdentity,
      focus,
      abortSignal: input.abortSignal,
    });
  }

  private async settleAborted(input: {
    job: RunJob;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    abortSignal: AbortSignal;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
  }): Promise<void> {
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

  private async summarizeOrFail(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    plan: CompactionPlan;
    nextSeq: number;
    activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
    focus: string | null;
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

  private async plan(
    job: RunJob,
  ): Promise<OwnerCompactionPlan & { focus: string | null }> {
    return this.tenantDb.runAs(job.userId, async (tx) => {
      const planned = await planOwnerCompaction(
        new MessagesRepository(tx),
        job.chatId,
        job.userId,
      );

      const flags = await readCreatedFlags(tx, job.runId, job.userId);

      return { ...planned, focus: flags.focus };
    });
  }

  private async summarize(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { messageId: string | null }>;
    plan: CompactionPlan;
    nextSeq: number;
    activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
    focus: string | null;
    abortSignal: AbortSignal;
  }): Promise<CompactionSummary | null> {
    const instruction = renderCompactionInstruction('owner', input.focus);

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
      instruction,
      ...(input.claim.effort !== undefined && { effort: input.claim.effort }),
    });
  }

  private async finish(input: {
    job: RunJob;
    attemptId: string;
    summary: CompactionSummary | undefined;
    expectedQueueIdentity: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
    focus: string | null;
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
      focus: input.focus,
    });
  }
}
