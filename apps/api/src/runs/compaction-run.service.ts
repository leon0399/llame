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
  RunNotRunnableError,
  type RunClaimResult,
} from './run-execution.service';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import type { QuotaRequestState } from './quota-wake-projection';
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
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { TenantDbService } from '../db/tenant-db.service';
import { modelRequestFailure } from './model-request-failure';
import { readCreatedFlags } from './run-created-flags';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';

type CompactionRunAttempt = {
  job: RunJob;
  claim: Extract<RunClaimResult, { messageId: string | null }>;
  abortSignal: AbortSignal;
  expectedQueueIdentity: {
    currentJobId: string | null;
    wakeGeneration: number;
  };
};

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
      | 'claimRun'
      | 'completeCompactionRun'
      | 'settleTerminalRun'
      | 'recordModelRetry'
      | 'suspendCompactionForQuota'
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
      quotaRequest: input.claim.quotaRequest,
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
      quotaRequest: input.claim.quotaRequest,
    });
  }

  private async settleAborted(input: CompactionRunAttempt): Promise<void> {
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

  private async summarizeOrFail(
    input: CompactionRunAttempt & {
      client: ModelClient;
      plan: CompactionPlan;
      nextSeq: number;
      activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
      focus: string | null;
    },
  ): Promise<CompactionSummary | undefined> {
    let retryWriteError: unknown;

    try {
      const summary = await this.summarize(input, (retry) =>
        this.execution
          .recordModelRetry(
            { ...input.job, attemptId: input.claim.attemptId },
            retry,
          )
          .catch((error: unknown) => {
            retryWriteError = error;
            throw error;
          }),
      );

      if (summary === null)
        throw new Error('Compaction summary returned no valid text summary.');

      return summary;
    } catch (error) {
      if (input.abortSignal.aborted) throw error;

      if (retryWriteError instanceof RunNotRunnableError) return undefined;

      await this.handleSummaryFailure(
        input,
        error,
        retryWriteError !== undefined,
      );

      return undefined;
    }
  }

  private async handleSummaryFailure(
    input: CompactionRunAttempt,
    error: unknown,
    retryWriteFailed: boolean,
  ): Promise<void> {
    if (
      !retryWriteFailed &&
      error instanceof ProviderFailure &&
      (await this.execution.suspendCompactionForQuota({
        run: {
          runId: input.job.runId,
          chatId: input.job.chatId,
          userId: input.job.userId,
        },
        attemptId: input.claim.attemptId,
        error,
        request: input.claim.quotaRequest,
        resumeAt: 'compactionRun',
        parts: [],
      }))
    ) {
      return;
    }

    await this.failSummary(
      { ...input, attemptId: input.claim.attemptId },
      error,
      retryWriteFailed,
    );
  }

  private async failSummary(
    input: {
      job: RunJob;
      attemptId: string;
      expectedQueueIdentity: {
        currentJobId: string | null;
        wakeGeneration: number;
      };
    },
    error: unknown,
    retryWriteFailed: boolean,
  ): Promise<void> {
    const failure = retryWriteFailed
      ? { message: 'Failed to persist the model retry before its delay.' }
      : {
          message: errorMessageWithoutParams(error),
          ...modelRequestFailure(error),
        };

    await this.execution.settleTerminalRun({
      runId: input.job.runId,
      userId: input.job.userId,
      status: 'failed',
      attemptId: input.attemptId,
      expectedQueueIdentity: input.expectedQueueIdentity,
      runPayload: { status: 'failed', ...failure },
      error: failure,
    });
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

  private async summarize(
    input: CompactionRunAttempt & {
      client: ModelClient;
      plan: CompactionPlan;
      nextSeq: number;
      activeCheckpoint: OwnerCompactionPlan['activeCheckpoint'];
      focus: string | null;
    },
    onRetry: ModelStreamInput['onRetry'],
  ): Promise<CompactionSummary | null> {
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
      onRetry,
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
    quotaRequest?: QuotaRequestState;
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
      ...(input.quotaRequest && { quotaRequest: input.quotaRequest }),
    });
  }
}
