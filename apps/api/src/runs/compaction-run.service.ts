import { Inject, Injectable } from '@nestjs/common';

import { toContextCheckpoint } from '../chats/context-item-producers';
import { MessagesRepository } from '../chats/messages-repository';
import { errorMessageWithoutParams } from '../db/loggable-error';
import { ContextIncompatibleError } from './model-context-errors';
import {
  RunExecutionService,
  type RunClaimResult,
} from './run-execution.service';
import { RunsRepository } from './runs-repository';
import { type RunJob } from './run-queues';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import {
  buildCompactionRequest,
  planCompactionCheckpoint,
  renderCompactionInstruction,
  requestFitsContextWindow,
  type CompactionRequest,
  type CompactionPlan,
} from '../compaction/compaction';
import {
  CompactionService,
  toStoredMessages,
  type CompactionSummary,
} from '../compaction/compaction.service';
import {
  createRunMediaResolver,
  type RunMediaResolver,
} from '../media/media-descriptors';
import { mergeRetainedMedia } from '../media/attempt-media';
import { loadMediaSizing } from '../media/epoch-admission';
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
    } = {
      currentJobId: null,
      wakeGeneration: 0,
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

    const plan = await this.plan(job);

    if (plan === null) {
      await this.finish(job, claim.attemptId, undefined, expectedQueueIdentity);

      return;
    }

    const summary = await this.summarizeOrFail({
      job,
      client,
      claim,
      plan,
      abortSignal,
      expectedQueueIdentity,
    });

    if (summary === undefined) return;

    await this.finish(job, claim.attemptId, summary, expectedQueueIdentity);
  }

  private async summarizeOrFail(input: {
    job: RunJob;
    client: ModelClient;
    claim: Extract<RunClaimResult, { attemptId: string }>;
    plan: CompactionPlan;
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

  private async plan(job: RunJob): Promise<CompactionPlan | null> {
    return this.tenantDb.runAs(job.userId, async (tx) => {
      const messages = new MessagesRepository(tx);

      const active = await messages.findActiveCheckpoint(
        job.chatId,
        job.userId,
        { beforeSeq: Number.MAX_SAFE_INTEGER },
      );

      const rows = await messages.findByChatId(job.chatId, job.userId, {
        sinceSeq: active?.absorbedThroughSeq,
      });

      const nextSeq = (rows.at(-1)?.seq ?? active?.absorbedThroughSeq ?? 0) + 1;

      return planCompactionCheckpoint({
        rows: toStoredMessages(rows),
        boundarySeq: active?.absorbedThroughSeq ?? 0,
        triggeringUserSeq: nextSeq,
      });
    });
  }

  private async summarize(input: {
    job: RunJob;
    client: ModelClient;
    claim: { attemptId: string; effort?: string };
    plan: CompactionPlan;
    abortSignal: AbortSignal;
  }): Promise<CompactionSummary | null> {
    const request = await this.prepareSummaryRequest({
      job: input.job,
      client: input.client,
      plan: input.plan,
      nextSeq: input.plan.uptoSeq + 1,
    });

    const common = {
      chatId: input.job.chatId,
      userId: input.job.userId,
      triggeringUserSeq: input.plan.uptoSeq + 1,
      plan: input.plan,
      reservedOutputTokens: request.reservedOutputTokens,
      abortSignal: input.abortSignal,
      media: request.media,
    };

    if (request.fits) {
      return this.compaction.summarizeCheckpoint({
        ...common,
        variant: 'owner',
        client: input.client,
        system: request.sourceSystem,
        instruction: renderCompactionInstruction('owner'),
        ...(input.claim.effort !== undefined && { effort: input.claim.effort }),
      });
    }

    return this.compaction.summarizeCheckpoint({
      ...common,
      variant: 'window',
      instruction: renderCompactionInstruction('owner'),
    });
  }

  private async prepareSummaryRequest(input: {
    job: RunJob;
    client: ModelClient;
    plan: CompactionPlan;
    nextSeq: number;
  }) {
    const sourceSystem = await this.sourceSystem(input.job, input.nextSeq);
    const media = createRunMediaResolver(this.tenantDb, input.job.userId);

    const previous = await this.tenantDb.runAs(input.job.userId, (tx) =>
      new MessagesRepository(tx).findActiveCheckpoint(
        input.job.chatId,
        input.job.userId,
        { beforeSeq: input.nextSeq },
      ),
    );

    const request = buildCompactionRequest({
      ...(sourceSystem !== undefined && { system: sourceSystem }),
      modelId: input.client.model,
      previous:
        previous === undefined ? undefined : toContextCheckpoint(previous),
      absorb: input.plan.absorb,
      instruction: renderCompactionInstruction('owner'),
    });

    mergeRetainedMedia(media.retainedMedia, request.retainedMedia);

    const reservedOutputTokens =
      this.instanceConfig.config.runs.maxOutputTokens;

    const fits = await this.fitsRequest({
      client: input.client,
      request,
      media,
      reservedOutputTokens,
    });

    if (!fits && sourceSystem === undefined) {
      throw new ContextIncompatibleError(
        'The complete request exceeds the target model context window and no previous completed run can summarize its history.',
      );
    }

    return { sourceSystem, media, reservedOutputTokens, fits };
  }

  private async fitsRequest(input: {
    client: ModelClient;
    request: CompactionRequest;
    media: RunMediaResolver;
    reservedOutputTokens: number | null;
  }): Promise<boolean> {
    const mediaSizing = await loadMediaSizing(
      input.request.messages,
      input.media,
      {
        input: input.client.input ?? ['text'],
        contextWindowTokens: input.client.contextWindowTokens,
        reservedOutputTokens: input.reservedOutputTokens,
      },
    );

    return requestFitsContextWindow({
      system: input.request.system,
      messages: input.request.messages,
      toolDeclarations: [],
      contextWindowTokens: input.client.contextWindowTokens,
      reservedOutputTokens: input.reservedOutputTokens,
      media: mediaSizing,
    });
  }

  private async sourceSystem(
    job: RunJob,
    beforeSeq: number,
  ): Promise<string | undefined> {
    return this.tenantDb.runAs(job.userId, async (tx) => {
      const source = await new RunsRepository(tx).findCompletedReplyRunBefore(
        job.chatId,
        job.userId,
        { beforeSeq },
      );

      const run = source?.run;

      if (run?.completedAttemptId == null) return undefined;

      const receipt = await new SystemPromptReceiptsRepository(
        tx,
      ).findByAttempt(run.id, run.completedAttemptId, job.userId);

      return receipt?.systemPrompt;
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
