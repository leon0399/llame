import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type CallOptions, type Client } from '@connectrpc/connect';
import {
  BASH_BOUNDS,
  JobState,
  LostCause,
  MachineProtocolError,
  OutputStream,
  JobService,
  type CreateJobResponse,
  type Job,
  type ProcBashResult,
} from '@workspace/machine-protocol';
import { sanitizeKnownResultAtBound } from '@workspace/bash-executor';
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
import { reserveArtifactSeq } from '../tools/artifacts/artifact-writer';
import { spillBashResult } from '../tools/bash-spill';
import { type BashInput, type BashMachineTarget } from '../tools/bash-target';
import { machineProtocolFailureResult } from '../tools/machine-call';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { settleBashJob } from './bash-job-store';
import { formatJobLocator } from './job-locator';

const JOB_OUTPUT_LIMIT = BigInt(BASH_BOUNDS.outputBound * 4);
const RECONCILE_INTERVAL_MS = 60_000;
const FOREGROUND_MAX_MS = 300_000;
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
    const { runId, attemptId, toolCallId } = context;
    if (!runId || !attemptId || !toolCallId)
      return unavailable('The Run identity is unavailable.');
    if (input.unlimited === true && context.allowUnlimitedJobs !== true)
      return unavailable(
        'tools.jobs.allowUnlimited is false; unlimited jobs are not allowed.',
      );

    const startedAt = new Date();
    const daemonJobId = randomBytes(16).toString('hex');
    const lifetimeMs =
      input.unlimited === true
        ? 0
        : this.config.config.tools.jobs.maxSeconds * 1000;
    const { client, instanceId, ended, callOptions } =
      await this.connector.jobsClient(machine.name);
    const seq = await reserveArtifactSeq(this.tenantDb, {
      chatId: context.chatId,
      userId: context.userId,
    });
    const deadlineAt =
      lifetimeMs === 0 ? undefined : new Date(startedAt.getTime() + lifetimeMs);
    const row = await this.tenantDb.runAs(context.userId, (db) =>
      new ChatJobsRepository(db).insert({
        chatId: context.chatId,
        ownerUserId: context.userId,
        kind: 'bash',
        seq,
        runId,
        toolCallId,
        machineName: machine.name,
        daemonInstanceId: instanceId,
        daemonJobId,
        startedAt,
        ...(deadlineAt !== undefined && { deadlineAt }),
        outputs: ['stdout', 'stderr'],
        artifactReadable: context.artifactReadable === true,
        settings: context.jobSettings ?? {
          selector: 'unknown',
          permissionMode: 'default',
        },
      }),
    );
    const removeUnstartedRow = () =>
      this.tenantDb.runAs(context.userId, (db) =>
        new ChatJobsRepository(db).deleteRunning(
          row.chatId,
          row.ownerUserId,
          row.id,
        ),
      );
    let started: CreateJobResponse;
    try {
      started = await client.createJob(
        {
          jobId: daemonJobId,
          owner: context.userId,
          command: input.command,
          ...(machine.path !== undefined && { cwd: machine.path }),
          ...(input.env !== undefined && { env: input.env }),
          ...(lifetimeMs > 0 && {
            timeout: { seconds: BigInt(lifetimeMs / 1000), nanos: 0 },
          }),
        },
        callOptions({
          envelope: {
            toolCallId,
            budgetMs: context.timeoutMs ?? 30_000,
          },
        }),
      );
    } catch (error) {
      if (
        !(error instanceof MachineProtocolError) ||
        error.code !== 'machine_job_limit'
      )
        throw error;
      await removeUnstartedRow();
      return machineProtocolFailureResult(machine.name, error);
    }
    if (started.result.case === 'failure') {
      await removeUnstartedRow();
      return unavailable(started.result.value.message);
    }
    context.onHostCommandStarted?.();

    if (input.async === true) return backgrounded(row, 'async', 0);
    this.foregroundJobs.add(row.id);

    const waitMs = Math.min(
      context.timeoutMs ?? FOREGROUND_MAX_MS,
      context.bashBackgroundAfterSeconds === undefined
        ? this.config.config.tools.bash.backgroundAfterSeconds * 1000
        : context.bashBackgroundAfterSeconds * 1000,
      FOREGROUND_MAX_MS,
    );
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
      this.foregroundJobs.delete(row.id);
      return backgrounded(row, outcome.cause, Date.now() - startedAt.getTime());
    }
    if (outcome.kind === 'disconnected') {
      this.foregroundJobs.delete(row.id);
      return backgrounded(row, 'disconnect', Date.now() - startedAt.getTime());
    }
    if (outcome.kind === 'cancelled') {
      this.foregroundJobs.delete(row.id);
      await this.requestStop(row, 'assistant');
      await this.stopDaemonJob(row.machineName, row);
      return unavailable(
        'The Run was cancelled; the Machine job stop was requested.',
      );
    }

    const result = await this.readResult(
      client,
      callOptions,
      row,
      outcome.job,
      configuredCredentials(this.config.config),
    );
    await this.settleDaemonJob(row, outcome.job, result, false);
    this.foregroundJobs.delete(row.id);
    await this.release(client, callOptions, row);
    return spillBashResult(context, result, machine.local);
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
    return typeof job === 'string'
      ? this.stop(job, 'worker')
      : this.stopDaemonJob(job.machineName, job).catch(() => undefined);
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

  private async observe(
    instanceId: string,
    client: JobsClient,
    callOptions: JobsCallOptions,
    daemonJob: Job,
  ): Promise<void> {
    let row = await this.tenantDb.runAs(daemonJob.owner, (db) =>
      new ChatJobsRepository(db).findByDaemonJob(
        daemonJob.owner,
        instanceId,
        daemonJob.id,
      ),
    );
    let observedJob = daemonJob;
    if (row === undefined) {
      row = await this.tenantDb.runAs(daemonJob.owner, (db) =>
        new ChatJobsRepository(db).findByOwnerDaemonJob(
          daemonJob.owner,
          daemonJob.id,
        ),
      );
      if (row === undefined || row.state !== 'running') return;
      observedJob = {
        ...daemonJob,
        state: JobState.LOST,
        lostCause:
          row.daemonInstanceId === instanceId
            ? LostCause.DAEMON_RESTARTED
            : LostCause.MACHINE_REBOOTED,
      };
    }

    if (
      row.stopRequestedAt !== null &&
      observedJob.state === JobState.RUNNING
    ) {
      try {
        await client.cancelJob(
          {
            requestId: row.daemonJobId,
            jobId: row.daemonJobId,
            owner: row.ownerUserId,
          },
          callOptions(),
        );
      } catch {
        // A reconnect will retry the durable stop request.
      }
      return;
    }
    if (observedJob.state === JobState.RUNNING) return;
    const result = await this.readResult(
      client,
      callOptions,
      row,
      observedJob,
      configuredCredentials(this.config.config),
    );
    await this.settleDaemonJob(
      row,
      observedJob,
      result,
      !this.foregroundJobs.has(row.id),
    );
    await this.release(client, callOptions, row).catch(() => undefined);
  }

  private async listMachine(machineName: string): Promise<void> {
    const { client, callOptions, instanceId } =
      await this.connector.jobsClient(machineName);
    const list = await client.listJobs({}, callOptions());
    for (const job of list.jobs)
      await this.observe(instanceId, client, callOptions, job);
  }

  private async waitForSettlement(
    client: JobsClient,
    callOptions: JobsCallOptions,
    ended: Promise<unknown>,
    jobId: string,
    waitMs: number,
    moveSignal: AbortSignal | undefined,
    abortSignal: AbortSignal | undefined,
  ): Promise<
    | { kind: 'settled'; job: Job }
    | { kind: 'moved'; cause: 'time' | 'message' }
    | { kind: 'disconnected' }
    | { kind: 'cancelled' }
  > {
    const controller = new AbortController();
    const watch = async () => {
      for await (const response of client.watchJobs(
        {},
        callOptions({ signal: controller.signal, budgetMs: waitMs }),
      )) {
        if (
          response.event.case === 'job' &&
          response.event.value.id === jobId &&
          response.event.value.state !== JobState.RUNNING
        )
          return response.event.value;
      }
      throw new Error('Jobs.WatchJobs ended');
    };
    const timer = new Promise<'time'>((resolve) =>
      setTimeout(() => resolve('time'), waitMs),
    );
    const move =
      moveSignal === undefined
        ? new Promise<never>(() => undefined)
        : new Promise<'message'>((resolve) =>
            moveSignal.addEventListener('abort', () => resolve('message'), {
              once: true,
            }),
          );
    const cancel =
      abortSignal === undefined
        ? new Promise<never>(() => undefined)
        : new Promise<'cancelled'>((resolve) =>
            abortSignal.addEventListener('abort', () => resolve('cancelled'), {
              once: true,
            }),
          );
    try {
      const outcome = await Promise.race([
        watch(),
        timer,
        move,
        cancel,
        ended.then(() => 'disconnect' as const),
      ]);
      if (outcome === 'time') return { kind: 'moved', cause: 'time' };
      if (outcome === 'message') return { kind: 'moved', cause: 'message' };
      if (outcome === 'cancelled') return { kind: 'cancelled' };
      if (outcome === 'disconnect') return { kind: 'disconnected' };
      return { kind: 'settled', job: outcome };
    } finally {
      controller.abort();
    }
  }

  private async readResult(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
    job: Job,
    credentials: ReadonlyArray<string>,
  ): Promise<ProcBashResult> {
    if (job.state === JobState.LOST)
      return {
        status: 'error',
        type: 'outcome_unknown',
        attemptId: row.runId,
        message: `The Machine daemon lost the job (${lostCauseText(lostCause(job.lostCause))}).`,
      };
    const stdout = await this.readOutput(
      client,
      callOptions,
      row,
      OutputStream.STDOUT,
    );
    const stderr = await this.readOutput(
      client,
      callOptions,
      row,
      OutputStream.STDERR,
    );
    const wallTimeMs = elapsedMs(job);
    const truncated =
      job.stdout?.truncated === true || job.stderr?.truncated === true;
    const result: ProcBashResult =
      job.state === JobState.TIMED_OUT
        ? {
            status: 'error',
            type: 'timed_out',
            durationMs: wallTimeMs,
            wallTimeMs,
            stdout,
            stderr,
            truncated,
          }
        : {
            status: job.state === JobState.SUCCEEDED ? 'success' : 'error',
            exitCode:
              job.exitCode ?? (job.state === JobState.SUCCEEDED ? 0 : 1),
            stdout,
            stderr,
            truncated,
            wallTimeMs,
          };
    return sanitizeKnownResultAtBound(
      result,
      { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
      credentials,
    );
  }

  private async readOutput(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
    stream: OutputStream,
  ): Promise<string> {
    const chunks: Array<Buffer> = [];
    for await (const part of client.readOutput(
      {
        jobId: row.daemonJobId,
        owner: row.ownerUserId,
        stream,
        offset: 0n,
        limit: JOB_OUTPUT_LIMIT,
      },
      callOptions(),
    ))
      chunks.push(Buffer.from(part.data));
    return Buffer.concat(chunks).toString('utf8');
  }

  private async settleDaemonJob(
    row: ChatJob,
    job: Job,
    result: ProcBashResult,
    backgrounded: boolean,
  ): Promise<void> {
    const truncatedStreams = {
      stdout: job.stdout?.truncated === true,
      stderr: job.stderr?.truncated === true,
    };
    const settlement: JobSettlement =
      job.state === JobState.LOST
        ? {
            state: 'lost',
            result: { outcomeUnknown: true, cause: lostCause(job.lostCause) },
          }
        : job.state === JobState.TIMED_OUT
          ? {
              state: 'timed_out',
              result: {
                exitCode: job.exitCode ?? null,
                signal: job.signal ?? null,
                truncated: truncatedStreams,
              },
            }
          : job.state === JobState.CANCELLED
            ? {
                state: 'cancelled',
                stoppedBy: row.stopRequestedBy ?? 'assistant',
                result: {
                  exitCode: job.exitCode ?? null,
                  signal: job.signal ?? null,
                },
              }
            : {
                state:
                  job.state === JobState.SUCCEEDED ? 'succeeded' : 'failed',
                result: {
                  exitCode: job.exitCode ?? null,
                  signal: job.signal ?? null,
                  truncated: truncatedStreams,
                },
              };
    const output =
      'stdout' in result
        ? {
            stdout: result.stdout,
            stderr: result.stderr,
            truncated: result.truncated,
            truncatedStreams,
          }
        : {
            stdout: '',
            stderr: '',
            truncated: false,
            truncatedStreams: { stdout: false, stderr: false },
          };
    await settleBashJob(
      this.tenantDb,
      row,
      { output, settlement },
      {
        maxBytes: this.config.config.tools.artifacts.maxBytes,
        hostFiles: false,
        backgrounded,
        noticeRuns: this.noticeRuns,
        wake: this.runWait,
      },
    );
  }

  private async release(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
  ): Promise<void> {
    await client.deleteJob(
      {
        requestId: row.daemonJobId,
        jobId: row.daemonJobId,
        owner: row.ownerUserId,
      },
      callOptions(),
    );
  }

  private async stopDaemonJob(
    machineName: string,
    row: ChatJob,
  ): Promise<void> {
    try {
      const { client, callOptions } =
        await this.connector.jobsClient(machineName);
      await client.cancelJob(
        {
          requestId: row.daemonJobId,
          jobId: row.daemonJobId,
          owner: row.ownerUserId,
        },
        callOptions(),
      );
    } catch {
      // The committed request is delivered by the next Watch snapshot.
    }
  }

  private async findRunningById(jobId: string): Promise<ChatJob | undefined> {
    // The run-control notification carries an owner-scoped job id. Search the
    // attached daemon snapshots, whose owner tags supply the RLS identity.
    for (const name of this.connector.names()) {
      try {
        const { client, callOptions, instanceId } =
          await this.connector.jobsClient(name);
        const list = await client.listJobs({}, callOptions());
        for (const job of list.jobs) {
          const row = await this.tenantDb.runAs(job.owner, (db) =>
            new ChatJobsRepository(db).findByDaemonJob(
              job.owner,
              instanceId,
              job.id,
            ),
          );
          if (row?.id === jobId) return row;
        }
      } catch {
        /* The request remains in chat_jobs for the next attachment. */
      }
    }
    return undefined;
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

function lostCause(cause: LostCause): string {
  if (cause === LostCause.MACHINE_REBOOTED) return 'machine_rebooted';
  if (cause === LostCause.CANCEL_UNPROVED) return 'stop_unproved';
  return 'daemon_restarted';
}

function elapsedMs(job: Job): number {
  if (job.createdAt === undefined) return 0;
  const started =
    Number(job.createdAt.seconds) * 1000 + job.createdAt.nanos / 1_000_000;
  const ended =
    job.endedAt === undefined
      ? Date.now()
      : Number(job.endedAt.seconds) * 1000 + job.endedAt.nanos / 1_000_000;
  return Math.max(0, ended - started);
}

function lostCauseText(cause: string): string {
  if (cause === 'machine_rebooted') return 'Machine rebooted';
  if (cause === 'stop_unproved') return 'stop not proved';
  return 'daemon restarted';
}
