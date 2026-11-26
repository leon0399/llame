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
import { BashJobRegistryRunStageService } from './bash-job-registry-run-stage.service';

const RECONCILE_INTERVAL_MS = 60_000;

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

type CancelledJobInput = {
  context: ToolContext;
  row: ChatJob;
  client: JobsClient;
  callOptions: JobsCallOptions;
  ended: Promise<unknown>;
  daemonJobId: string;
  machine: BashMachineTarget;
};

@Injectable()
export class BashJobRegistry implements OnModuleInit {
  private readonly logger = new Logger(BashJobRegistry.name);
  private readonly loops = new Set<Promise<void>>();
  private readonly foregroundJobs = new Set<string>();
  private readonly settlements = new Set<Promise<void>>();
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
    @Inject(BashJobRegistryRunStageService)
    private readonly runStage: BashJobRegistryRunStageService,
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
      settleLost: (row, job) =>
        this.settleDaemonJob(row, job, null, row.delivery === 'background'),
    });

    if (started.kind === 'failed') return started.result;

    return this.runStarted(context, machine, input, started);
  }

  private async runStarted(
    context: ToolContext,
    machine: BashMachineTarget,
    input: BashInput,
    started: Extract<
      Awaited<ReturnType<typeof startBashJobStage>>,
      { kind: 'started' }
    >,
  ): Promise<ToolResult> {
    const { row, client, callOptions, ended, daemonJobId, startedAt } = started;

    if (input.async === true)
      return this.recordNativeResult(context, backgrounded(row, 'async', 0));

    this.foregroundJobs.add(row.id);

    const outcome = await this.waitForSettlement({
      client,
      callOptions,
      ended,
      jobId: daemonJobId,
      waitMs:
        Math.min(
          context.bashBackgroundAfterSeconds ??
            this.config.config.tools.bash.backgroundAfterSeconds,
          this.config.config.tools.callTimeoutSeconds,
        ) * 1000,
      moveSignal: context.moveSignal,
      abortSignal: context.abortSignal,
    });

    return this.finishRunOutcome({
      context,
      machine,
      row,
      outcome,
      startedAt,
      started,
    });
  }

  private async finishRunOutcome(input: {
    context: ToolContext;
    machine: BashMachineTarget;
    row: ChatJob;
    outcome: Awaited<ReturnType<typeof waitForSettlementStage>>;
    startedAt: Date;
    started: Extract<
      Awaited<ReturnType<typeof startBashJobStage>>,
      { kind: 'started' }
    >;
  }): Promise<ToolResult> {
    const { context, machine, row, outcome, startedAt, started } = input;

    if (outcome.kind === 'moved')
      return this.finishMovedRun(
        context,
        row,
        outcome.cause,
        Date.now() - startedAt.getTime(),
      );

    if (outcome.kind === 'disconnected') {
      this.foregroundJobs.delete(row.id);

      return this.recordNativeResult(
        context,
        backgrounded(row, 'disconnect', Date.now() - startedAt.getTime()),
      );
    }

    if (outcome.kind === 'cancelled')
      return this.settleCancelledJob({ context, ...started, machine });

    return this.finishSettledRun({
      context,
      machine,
      row,
      job: outcome.job,
      started,
    });
  }

  private async finishMovedRun(
    context: ToolContext,
    row: ChatJob,
    cause: 'time' | 'message',
    wallTimeMs: number,
  ): Promise<ToolResult> {
    context.onHostPromotionStarted?.();
    await this.promoteBackground(row);
    const result = backgrounded(row, cause, wallTimeMs);
    const finalResult = await this.recordNativeResult(context, result);
    this.foregroundJobs.delete(row.id);

    return finalResult;
  }

  private async finishSettledRun(input: {
    context: ToolContext;
    machine: BashMachineTarget;
    row: ChatJob;
    job: Job;
    started: Extract<
      Awaited<ReturnType<typeof startBashJobStage>>,
      { kind: 'started' }
    >;
  }): Promise<ToolResult> {
    const { context, machine, row, job, started } = input;
    const { client, callOptions } = started;

    const { result, output } = await readBashJobResult({
      config: this.config,
      client,
      callOptions,
      row,
      job,
      credentials: configuredCredentials(this.config.config),
    });

    const finalResult = await this.recordNativeResult(
      context,
      await spillBashResult(context, result, machine.local),
    );

    await this.settleDaemonJob(row, job, output, false);
    this.foregroundJobs.delete(row.id);
    await this.release(client, callOptions, row);

    return finalResult;
  }

  private async settleCancelledJob(
    input: CancelledJobInput,
  ): Promise<ToolResult> {
    const { context, row, client, callOptions, ended, daemonJobId } = input;

    await this.requestStop(row, 'assistant');
    await this.stopDaemonJob(row.machineName, row);

    try {
      const outcome = await this.waitForSettlement({
        client,
        callOptions,
        ended,
        jobId: daemonJobId,
        waitMs: 750,
        moveSignal: undefined,
        abortSignal: undefined,
      });

      if (outcome.kind === 'settled')
        return this.recordCancelledResult(input, outcome.job);
    } catch {
      // A stop without a settled daemon result cannot be proved.
    }

    this.foregroundJobs.delete(row.id);

    return this.recordNativeResult(
      context,
      machineUnknownResult(row.machineName),
    );
  }

  private async recordCancelledResult(
    input: CancelledJobInput,
    job: Job,
  ): Promise<ToolResult> {
    const { context, row, client, callOptions, machine } = input;

    const { result, output } = await readBashJobResult({
      config: this.config,
      client,
      callOptions,
      row,
      job,
      credentials: configuredCredentials(this.config.config),
    });

    const finalResult = await this.recordNativeResult(
      context,
      await spillBashResult(context, result, machine.local),
    );

    await this.settleDaemonJob(row, job, output, false);
    await this.release(client, callOptions, row);
    this.foregroundJobs.delete(row.id);

    return finalResult;
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
    if (isChatJob(job))
      return this.stopDaemonJob(job.machineName, job).catch(() => undefined);

    return this.stop(job, 'worker');
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

    clearInterval(this.reconcileTimer);
    this.close();
    await Promise.allSettled(this.loops);

    while (this.settlements.size > 0)
      await Promise.allSettled(this.settlements);
  }

  private async watchMachine(machineName: string): Promise<void> {
    // A Machine that cannot be reached is retried with a growing delay, up to
    // the probe interval, so an offline box costs one log line a minute.
    let delayMs = 1000;

    while (!this.stopping) {
      try {
        const { client, callOptions, ended, instanceId } =
          await this.connector.jobsClient(machineName);

        const controller = new AbortController();

        const consume = async () => {
          for await (const response of client.watchJobs(
            {},
            callOptions({ signal: controller.signal }),
          )) {
            if (response.event.case !== 'job') continue;
            const job = response.event.value;
            await this.observe(instanceId, client, callOptions, job);
          }
        };

        delayMs = 1000;
        const consuming = consume();

        try {
          await Promise.race([consuming, ended, this.closeWait]);
        } finally {
          controller.abort();
          await consuming.catch(() => undefined);
        }

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
    const settlement = observeDaemonJob({
      tenantDb: this.tenantDb,
      instanceId,
      client,
      callOptions,
      daemonJob,
      foregroundJobs: this.foregroundJobs,
      promote: (row) => this.promoteBackground(row),
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

    this.settlements.add(settlement);
    void settlement.then(
      () => this.settlements.delete(settlement),
      () => this.settlements.delete(settlement),
    );

    return settlement;
  }

  private listMachine(machineName: string): Promise<void> {
    return listMachineJobs({
      connector: this.connector,
      machineName,
      observe: (instanceId, client, callOptions, job) =>
        this.observe(instanceId, client, callOptions, job),
    });
  }

  private waitForSettlement(input: {
    client: JobsClient;
    callOptions: JobsCallOptions;
    ended: Promise<unknown>;
    jobId: string;
    waitMs: number;
    moveSignal: AbortSignal | undefined;
    abortSignal: AbortSignal | undefined;
  }) {
    return waitForSettlementStage(input);
  }

  private settleDaemonJob(
    row: ChatJob,
    job: Job,
    output: ManagedOutput | null,
    backgrounded: boolean,
  ): Promise<void> {
    return this.runStage.settle(row, job, output, backgrounded);
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

  private async promoteBackground(row: ChatJob): Promise<void> {
    await this.tenantDb.runAs(row.ownerUserId, (db) =>
      new ChatJobsRepository(db).promoteToBackground(
        row.chatId,
        row.ownerUserId,
        row.id,
      ),
    );
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

function isChatJob(job: string | ChatJob): job is ChatJob {
  return typeof job !== 'string';
}
