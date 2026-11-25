import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type CallOptions, type Client } from '@connectrpc/connect';
import { JobService, type Job } from '@workspace/machine-protocol';
import { type ManagedOutput } from '@workspace/bash-executor';
import { type ChatJob } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { configuredCredentials } from '../instance-config/configured-credentials';
import { MachineConnector } from '../machines/machine-connector.service';
import { MachineUnavailableError } from '../machines/machine-session-errors';
import type { MachineRequestOptions } from '../machines/machine-session';
import { JobNoticeRunService } from '../runs/job-notice-run.service';
import { RunWaitService } from '../runs/run-wait.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { spillBashResult } from '../tools/bash-spill';
import { type BashInput, type BashMachineTarget } from '../tools/bash-target';
import { machineUnknownResult } from '../tools/machine-call';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import { formatJobLocator } from './job-locator';
import { waitForSettlement as waitForSettlementStage } from './bash-job-registry-wait';
import { startBashJob as startBashJobStage } from './bash-job-registry-start';
import {
  releaseDaemonJob,
  stopDaemonJob as stopDaemonJobStage,
} from './bash-job-registry-release';
import {
  findRunningJob,
  listMachineJobs,
  observeDaemonJob,
} from './bash-job-registry-reconcile';
import { readBashJobResult } from './bash-job-registry-result';
import { settleDaemonJob as settleDaemonJobStage } from './bash-job-registry-settlement';

const RECONCILE_INTERVAL_MS = 60_000;

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

@Injectable()
export class BashJobRegistry implements OnModuleInit {
  private readonly logger = new Logger(BashJobRegistry.name);
  private readonly loops = new Set<Promise<void>>();
  private readonly foregroundJobs = new Set<string>();
  private stopping = false;
  private reconcileTimer: ReturnType<typeof setInterval> | undefined;
  private closeWait: Promise<void>;
  private close!: () => void;

  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    private readonly connector: MachineConnector,
    @Inject(InstanceConfigService)
    private readonly config: InstanceConfigReader,
    @Inject(JobNoticeRunService)
    private readonly noticeRuns: Pick<JobNoticeRunService, 'startOnSettlement'>,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {
    this.closeWait = new Promise((resolve) => (this.close = resolve));
  }

  onModuleInit(): void {
    for (const machineName of this.connector.names()) {
      const loop = this.watchMachine(machineName);
      this.loops.add(loop);
      void loop.finally(() => this.loops.delete(loop));
    }

    this.reconcileTimer = setInterval(
      () => void this.recheckJobs(),
      RECONCILE_INTERVAL_MS,
    );
    this.reconcileTimer.unref?.();
  }

  async run(
    context: ToolContext,
    machine: BashMachineTarget,
    input: BashInput,
  ): Promise<ToolResult> {
    const started = await startBashJobStage({
      tenantDb: this.tenantDb,
      connector: this.connector,
      config: this.config,
      context,
      machine,
      input,
    });

    if (started.kind === 'failed') return started.result;
    const { row, client, callOptions, ended, daemonJobId, startedAt } = started;

    if (input.async === true)
      return this.recordNativeResult(context, backgrounded(row, 'async', 0));
    this.foregroundJobs.add(row.id);

    const waitMs =
      (context.bashBackgroundAfterSeconds ??
        this.config.config.tools.bash.backgroundAfterSeconds) * 1000;

    const outcome = await this.waitForSettlement(
      client,
      callOptions,
      ended,
      daemonJobId,
      waitMs,
      context.moveSignal,
      context.abortSignal,
    );

    if (outcome.kind === 'moved') {
      const result = backgrounded(
        row,
        outcome.cause,
        Date.now() - startedAt.getTime(),
      );

      context.onHostPromotionStarted?.();
      const settled = await this.recordNativeResult(context, result);
      this.foregroundJobs.delete(row.id);

      return settled;
    }

    if (outcome.kind === 'disconnected') {
      this.foregroundJobs.delete(row.id);

      return this.recordNativeResult(
        context,
        backgrounded(row, 'disconnect', Date.now() - startedAt.getTime()),
      );
    }

    if (outcome.kind === 'cancelled')
      return this.settleCancelledJob({
        context,
        row,
        client,
        callOptions,
        ended,
        daemonJobId,
        machine,
      });

    const { result, output } = await readBashJobResult({
      config: this.config,
      client,
      callOptions,
      row,
      job: outcome.job,
      credentials: configuredCredentials(this.config.config),
    });

    const finalResult = await this.recordNativeResult(
      context,
      await spillBashResult(context, result, machine.local),
    );

    await this.settleDaemonJob(row, outcome.job, output, false);
    this.foregroundJobs.delete(row.id);
    await this.release(client, callOptions, row);

    return finalResult;
  }

  private async settleCancelledJob(input: {
    context: ToolContext;
    row: ChatJob;
    client: JobsClient;
    callOptions: JobsCallOptions;
    ended: Promise<unknown>;
    daemonJobId: string;
    machine: BashMachineTarget;
  }): Promise<ToolResult> {
    const { context, row, client, callOptions, ended, daemonJobId, machine } =
      input;

    await this.requestStop(row, 'assistant');
    await this.stopDaemonJob(row.machineName, row);

    try {
      const outcome = await this.waitForSettlement(
        client,
        callOptions,
        ended,
        daemonJobId,
        750,
        undefined,
        undefined,
      );

      if (outcome.kind === 'settled') {
        const { result, output } = await readBashJobResult({
          config: this.config,
          client,
          callOptions,
          row,
          job: outcome.job,
          credentials: configuredCredentials(this.config.config),
        });

        const finalResult = await this.recordNativeResult(
          context,
          await spillBashResult(context, result, machine.local),
        );

        await this.settleDaemonJob(row, outcome.job, output, false);
        await this.release(client, callOptions, row);
        this.foregroundJobs.delete(row.id);

        return finalResult;
      }
    } catch {
      // A stop without a settled daemon result cannot be proved.
    }

    this.foregroundJobs.delete(row.id);

    return this.recordNativeResult(
      context,
      machineUnknownResult(row.machineName),
    );
  }

  async stop(
    jobId: string,
    cause: 'owner' | 'assistant' | 'worker',
  ): Promise<void> {
    // Stop requests are durable in chat_jobs; the Watch snapshot delivers an
    // offline request as soon as the next session attaches.
    const row = await this.findRunningById(jobId);

    if (row === undefined) return;
    await this.requestStop(row, cause);
    await this.stopDaemonJob(row.machineName, row);
  }
  private async requestStop(
    row: ChatJob,
    cause: 'owner' | 'assistant' | 'worker',
  ): Promise<void> {
    if (row.stopRequestedAt !== null) return;
    await this.tenantDb.runAs(row.ownerUserId, async (db) => {
      await new ChatJobsRepository(db).requestStop(
        row.chatId,
        row.ownerUserId,
        row.id,
        cause,
      );
    });
  }

  recheckJob(job: string | ChatJob): Promise<void> {
    if (typeof job === 'string') return this.stop(job, 'worker');

    return this.stopDaemonJob(job.machineName, job).catch(() => undefined);
  }

  async recheckJobs(): Promise<void> {
    for (const machineName of this.connector.names())
      await this.listMachine(machineName).catch((error: unknown) =>
        this.logger.warn(
          `Machine jobs probe failed for ${machineName}: ${String(error)}`,
        ),
      );
  }

  async shutdown(): Promise<void> {
    this.stopping = true;

    if (this.reconcileTimer !== undefined) clearInterval(this.reconcileTimer);
    this.close();
    await Promise.allSettled(this.loops);
  }

  private async watchMachine(machineName: string): Promise<void> {
    // A Machine that cannot be reached is retried with a growing delay, up to
    // the probe interval, so an offline box costs one log line a minute.
    let delayMs = 1000;

    while (!this.stopping) {
      try {
        const { client, callOptions, ended, instanceId } =
          await this.connector.jobsClient(machineName);

        const consume = async () => {
          for await (const response of client.watchJobs({}, callOptions())) {
            if (response.event.case !== 'job') continue;
            const job = response.event.value;
            await this.observe(instanceId, client, callOptions, job);
          }
        };

        delayMs = 1000;
        await Promise.race([consume(), ended, this.closeWait]);

        if (this.stopping) return;
      } catch (error) {
        if (!(error instanceof MachineUnavailableError) || delayMs === 1000)
          this.logger.warn(
            `Machine jobs watch failed for ${machineName}: ${String(error)}`,
          );
        delayMs = Math.min(delayMs * 2, 60_000);
      }

      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, delayMs)),
        this.closeWait,
      ]);
    }
  }

  private observe(
    instanceId: string,
    client: JobsClient,
    callOptions: JobsCallOptions,
    daemonJob: Job,
  ): Promise<void> {
    return observeDaemonJob({
      tenantDb: this.tenantDb,
      instanceId,
      client,
      callOptions,
      daemonJob,
      foregroundJobs: this.foregroundJobs,
      readResult: (watchClient, watchOptions, row, job) =>
        readBashJobResult({
          config: this.config,
          client: watchClient,
          callOptions: watchOptions,
          row,
          job,
          credentials: configuredCredentials(this.config.config),
        }),
      settle: (row, job, output, isBackgrounded) =>
        this.settleDaemonJob(row, job, output, isBackgrounded),
      release: (watchClient, watchOptions, row) =>
        this.release(watchClient, watchOptions, row),
    });
  }

  private listMachine(machineName: string): Promise<void> {
    return listMachineJobs({
      connector: this.connector,
      machineName,
      observe: (instanceId, client, callOptions, job) =>
        this.observe(instanceId, client, callOptions, job),
    });
  }

  private waitForSettlement(
    client: JobsClient,
    callOptions: JobsCallOptions,
    ended: Promise<unknown>,
    jobId: string,
    waitMs: number,
    moveSignal: AbortSignal | undefined,
    abortSignal: AbortSignal | undefined,
  ) {
    return waitForSettlementStage({
      client,
      callOptions,
      ended,
      jobId,
      waitMs,
      moveSignal,
      abortSignal,
    });
  }

  private settleDaemonJob(
    row: ChatJob,
    job: Job,
    output: ManagedOutput | null,
    backgrounded: boolean,
  ): Promise<void> {
    return settleDaemonJobStage({
      tenantDb: this.tenantDb,
      config: this.config,
      noticeRuns: this.noticeRuns,
      runWait: this.runWait,
      row,
      job,
      output,
      backgrounded,
    });
  }

  private release(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
  ): Promise<void> {
    return releaseDaemonJob({ client, callOptions, row });
  }

  private stopDaemonJob(machineName: string, row: ChatJob): Promise<void> {
    return stopDaemonJobStage({ connector: this.connector, machineName, row });
  }

  private async recordNativeResult(
    context: ToolContext,
    result: ToolResult,
  ): Promise<ToolResult> {
    const { runId, attemptId, toolCallId } = context;

    if (!runId || !attemptId || !toolCallId) return result;

    return this.tenantDb.runAs(context.userId, async (db) => {
      const receipt = await new NativeFilesRepository(db).recoverHostPromotion({
        runId,
        userId: context.userId,
        attemptId,
        toolCallId,
        result,
      });

      return receipt.result;
    });
  }
  private findRunningById(jobId: string): Promise<ChatJob | undefined> {
    return findRunningJob({
      connector: this.connector,
      tenantDb: this.tenantDb,
      jobId,
    });
  }
}

function backgrounded(
  row: ChatJob,
  cause: 'async' | 'time' | 'message' | 'disconnect',
  wallTimeMs: number,
): ToolResult {
  return {
    status: 'success',
    backgrounded: true,
    job: formatJobLocator(row.kind, row.seq),
    cause,
    wallTimeMs,
  };
}

function unavailable(message: string): ToolResult {
  return { status: 'error', type: 'executor_unavailable', message };
}
