import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  startManagedBash,
  type BashCommandInput,
  type BashExecutorContext,
  type BashUnavailableResult,
  type BashTimedOutResult,
  type ManagedOutput,
  type ManagedBashHandle,
  type ManagedStopResult,
  type StartManagedBashOptions,
} from '@workspace/bash-executor';
import { type ToolResult } from '@workspace/runtime-safety';

import { type ChatDeliverySettings, type ChatJob } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { reserveArtifactSeq } from '../tools/artifacts/artifact-writer';
import { ChatJobsRepository } from './chat-jobs.repository';
import { appendJobOutput } from './bash-job-store';
import { type JobStopCause, BashJobLifecycle } from './bash-job-lifecycle';
import { JobPromotionError } from './job-promotion-error';
import { BashJobPromotion } from './bash-job-promotion';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

export type BashJobFacts = {
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly runId: string;
  readonly attemptId?: string;
  readonly toolCallId: string;
  readonly startedAt: Date;
  readonly settings: ChatDeliverySettings;
  readonly maxBytes: number;
  readonly configuredCredentials: ReadonlyArray<string>;
  readonly artifactReadable: boolean;
  readonly hostFiles: boolean;
  readonly unlimited?: boolean;
};

/** Worker-local authority over handles; stored jobs are readable on any worker. */
@Injectable()
export class BashJobRegistry implements OnModuleInit {
  private readonly logger = new Logger(BashJobRegistry.name);
  private accepting = true;
  private readonly promotions = new Set<Promise<unknown>>();
  private readonly lifecycle: BashJobLifecycle;
  private readonly promotion: BashJobPromotion;

  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(WorkerHeartbeatService)
    private readonly worker: Pick<
      WorkerHeartbeatService,
      'instanceId' | 'jobCheck'
    >,
    @Inject(InstanceConfigService)
    private readonly config: InstanceConfigReader,
  ) {
    this.lifecycle = new BashJobLifecycle(this.tenantDb, this.logger);
    this.promotion = new BashJobPromotion({
      tenantDb: this.tenantDb,
      workerInstanceId: this.worker.instanceId,
      config: this.config,
      logger: this.logger,
      trackJob: (handle, job, facts, output) =>
        this.lifecycle.trackJob(handle, job, facts, output),
    });
  }

  onModuleInit(): void {
    this.worker.jobCheck = () => this.recheckJobs();
  }

  recheckJobs(): Promise<void> {
    if (!this.accepting) return Promise.resolve();

    return this.lifecycle.recheckJobs();
  }

  recheckJob(jobId: string): Promise<void> {
    return this.lifecycle.recheckJob(jobId);
  }

  /** Admission and spawn are synchronous, so shutdown cannot pass between them. */
  start(
    input: BashCommandInput,
    context: BashExecutorContext,
    options: StartManagedBashOptions & { readonly unlimited?: boolean } = {},
  ): ManagedBashHandle | BashUnavailableResult | BashTimedOutResult {
    if (!this.accepting)
      return {
        status: 'error',
        type: 'unavailable',
        message: 'The worker is shutting down.',
      };

    const lifetimeMs = options.unlimited
      ? undefined
      : this.config.config.tools.jobs.maxSeconds * 1000;

    const handle = startManagedBash(input, context, {
      ...options,
      lifetimeMs,
    });

    if ('pid' in handle) this.lifecycle.trackCommand(handle);

    return handle;
  }

  promote(handle: ManagedBashHandle, facts: BashJobFacts): Promise<ChatJob> {
    const pending = this.promoteHandle(handle, facts);
    this.promotions.add(pending);
    void pending.then(
      () => this.promotions.delete(pending),
      () => this.promotions.delete(pending),
    );

    return pending;
  }

  promoteWithReceipt(
    handle: ManagedBashHandle,
    facts: BashJobFacts,
    resultForJob: (job: ChatJob) => ToolResult,
    resultForStop: (stopped: ManagedStopResult) => ToolResult,
  ): Promise<{
    result: ToolResult;
    receiptCommitted: boolean;
    recoveryWon: boolean;
  }> {
    if (!this.accepting) throw new Error('The worker is shutting down.');

    const pending = this.promotion.promote(handle, facts, {
      forJob: resultForJob,
      forStopped: resultForStop,
    });

    this.promotions.add(pending);
    void pending.then(
      () => this.promotions.delete(pending),
      () => this.promotions.delete(pending),
    );

    return pending;
  }

  private async promoteHandle(
    handle: ManagedBashHandle,
    supplied: BashJobFacts,
  ): Promise<ChatJob> {
    try {
      if (!this.accepting) throw new Error('The worker is shutting down.');

      const facts: BashJobFacts = {
        ...supplied,
        settings: { ...supplied.settings },
        startedAt: new Date(supplied.startedAt),
        configuredCredentials: [...supplied.configuredCredentials],
      };

      const seq = await reserveArtifactSeq(this.tenantDb, {
        chatId: facts.chatId,
        userId: facts.ownerUserId,
      });

      const deadlineAt =
        facts.unlimited === true
          ? undefined
          : new Date(
              facts.startedAt.getTime() +
                this.config.config.tools.jobs.maxSeconds * 1000,
            );

      const output = handle.snapshot();

      const row = await this.insertPromotion(handle, facts, {
        seq,
        deadlineAt,
        output,
      });

      this.lifecycle.trackJob(handle, row, facts, output);

      return row;
    } catch (error) {
      throw new JobPromotionError(await handle.stop('run'), { cause: error });
    }
  }

  private insertPromotion(
    handle: ManagedBashHandle,
    facts: BashJobFacts,
    capture: {
      seq: number;
      deadlineAt: Date | undefined;
      output: ManagedOutput;
    },
  ): Promise<ChatJob> {
    return this.tenantDb.runAs(facts.ownerUserId, async (db) => {
      const inserted = await new ChatJobsRepository(db).insert({
        chatId: facts.chatId,
        ownerUserId: facts.ownerUserId,
        executor: 'bash',
        seq: capture.seq,
        runId: facts.runId,
        toolCallId: facts.toolCallId,
        workerInstanceId: this.worker.instanceId,
        pid: handle.pid,
        startedAt: facts.startedAt,
        deadlineAt: capture.deadlineAt,
        outputs: ['stdout', 'stderr'],
        artifactReadable: facts.artifactReadable,
        settings: facts.settings,
      });

      await appendJobOutput(db, inserted, capture.output, {
        stdout: 0,
        stderr: 0,
      });

      return inserted;
    });
  }

  stop(jobId: string, cause: JobStopCause): Promise<void> {
    return this.lifecycle.stop(jobId, cause);
  }

  settlePending(): Promise<void> {
    return this.lifecycle.settlePending();
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    this.lifecycle.stopChecks();
    this.worker.jobCheck = undefined;
    await this.lifecycle.shutdown();
    await Promise.allSettled(this.promotions);
    await this.lifecycle.waitForCompletions();
  }
}
