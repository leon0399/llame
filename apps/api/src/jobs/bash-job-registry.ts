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
import {
  type BashKnownResult,
  type BashTimedOutResult,
  sanitizeKnownResultAtBound,
  type ManagedOutput,
} from '@workspace/bash-executor';
import { type ChatJob } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { configuredCredentials } from '../instance-config/configured-credentials';
import { MachineConnector } from '../machines/machine-connector.service';
import {
  MachineUnavailableError,
  mapMachineRefusal,
} from '../machines/machine-session-errors';
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
import { waitForSettlement as waitForSettlementStage } from './bash-job-registry-wait';
import { startBashJob as startBashJobStage } from './bash-job-registry-start';
import {
  releaseDaemonJob,
  stopDaemonJob as stopDaemonJobStage,
} from './bash-job-registry-release';

const JOB_OUTPUT_LIMIT = (maxBytes: number) => BigInt(maxBytes);
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
    const { result, output } = await this.readResult(
      client,
      callOptions,
      row,
      outcome.job,
      configuredCredentials(this.config.config),
    );
    await this.settleDaemonJob(row, outcome.job, output, false);
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
    const { output } = await this.readResult(
      client,
      callOptions,
      row,
      observedJob,
      configuredCredentials(this.config.config),
    );
    await this.settleDaemonJob(
      row,
      observedJob,
      output,
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

  private async readResult(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
    job: Job,
    credentials: ReadonlyArray<string>,
  ): Promise<{ result: ProcBashResult; output: ManagedOutput | null }> {
    let stdout: string;
    let stderr: string;
    let stdoutTruncated = job.stdout?.truncated === true;
    let stderrTruncated = job.stderr?.truncated === true;
    try {
      const stdoutOutput = await this.readOutput(
        client,
        callOptions,
        row,
        OutputStream.STDOUT,
      );
      const stderrOutput = await this.readOutput(
        client,
        callOptions,
        row,
        OutputStream.STDERR,
      );
      stdout = stdoutOutput.text;
      stderr = stderrOutput.text;
      stdoutTruncated ||= stdoutOutput.truncated;
      stdoutTruncated ||=
        BigInt(Buffer.byteLength(stdout)) < (job.stdout?.bytes ?? 0n);
      stderrTruncated ||=
        BigInt(Buffer.byteLength(stderr)) < (job.stderr?.bytes ?? 0n);
      stderrTruncated ||= stderrOutput.truncated;
    } catch (error) {
      const refusal = mapMachineRefusal(row.machineName, error, true);
      if (
        !(refusal instanceof MachineProtocolError) ||
        refusal.code !== 'machine_job_not_found'
      )
        throw refusal;
      if (job.state === JobState.LOST)
        return {
          result: {
            status: 'error',
            type: 'outcome_unknown',
            attemptId: row.runId,
            message: `The Machine daemon lost the job (${lostCauseText(lostCause(job.lostCause))}).`,
          },
          output: null,
        };
      stdout = '';
      stderr = '';
      const result = this.resultFromJob(job, stdout, stderr);
      return {
        result: sanitizeKnownResultAtBound(
          result,
          { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
          credentials,
        ),
        output: null,
      };
    }
    if (job.state === JobState.LOST) {
      const sanitized = sanitizeKnownResultAtBound(
        this.resultFromJob(job, stdout, stderr),
        { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
        credentials,
        {
          stdout: { endedByLlame: stdoutTruncated },
          stderr: { endedByLlame: stderrTruncated },
        },
      );
      return {
        result: {
          status: 'error',
          type: 'outcome_unknown',
          attemptId: row.runId,
          message: `The Machine daemon lost the job (${lostCauseText(lostCause(job.lostCause))}).`,
        },
        output: {
          stdout: sanitized.stdout,
          stderr: sanitized.stderr,
          truncated: sanitized.truncated || stdoutTruncated || stderrTruncated,
          truncatedStreams: {
            stdout: stdoutTruncated || job.stdout?.truncated === true,
            stderr: stderrTruncated || job.stderr?.truncated === true,
          },
        },
      };
    }
    const sanitized = sanitizeKnownResultAtBound(
      this.resultFromJob(job, stdout, stderr),
      { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
      credentials,
      {
        stdout: { endedByLlame: stdoutTruncated },
        stderr: { endedByLlame: stderrTruncated },
      },
    );
    return {
      result: sanitized,
      output: {
        stdout: sanitized.stdout,
        stderr: sanitized.stderr,
        truncated: sanitized.truncated || stdoutTruncated || stderrTruncated,
        truncatedStreams: {
          stdout: stdoutTruncated || job.stdout?.truncated === true,
          stderr: stderrTruncated || job.stderr?.truncated === true,
        },
      },
    };
  }

  private resultFromJob(
    job: Job,
    stdout: string,
    stderr: string,
  ): BashKnownResult | BashTimedOutResult {
    const wallTimeMs = elapsedMs(job);
    const truncated =
      job.stdout?.truncated === true || job.stderr?.truncated === true;
    return job.state === JobState.TIMED_OUT
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
          exitCode: job.exitCode ?? (job.state === JobState.SUCCEEDED ? 0 : 1),
          stdout,
          stderr,
          truncated,
          wallTimeMs,
        };
  }

  private async readOutput(
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
    stream: OutputStream,
  ): Promise<{ text: string; truncated: boolean }> {
    const maxBytes = this.config.config.tools.artifacts.maxBytes;
    const chunks: Array<Buffer> = [];
    let bytes = 0;
    let expectedOffset = 0n;
    let truncated = false;
    for await (const part of client.readOutput(
      {
        jobId: row.daemonJobId,
        owner: row.ownerUserId,
        stream,
        offset: 0n,
        limit: JOB_OUTPUT_LIMIT(maxBytes),
      },
      callOptions(),
    )) {
      if (part.offset !== expectedOffset)
        throw new Error(
          'Machine job output contains a gap or overlapping chunk',
        );
      expectedOffset += BigInt(part.data.byteLength);
      const available = maxBytes - bytes;
      if (available <= 0) {
        truncated = true;
        break;
      }
      const chunk = Buffer.from(part.data).subarray(0, available);
      chunks.push(chunk);
      bytes += chunk.byteLength;
      truncated ||= part.data.byteLength > available;
    }
    return {
      text: Buffer.concat(chunks).toString('utf8'),
      truncated,
    };
  }

  private async settleDaemonJob(
    row: ChatJob,
    job: Job,
    output: ManagedOutput | null,
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
    const settled: JobSettlement =
      output === null
        ? {
            ...settlement,
            result: { ...settlement.result, outputUnavailable: true },
          }
        : settlement;
    await settleBashJob(
      this.tenantDb,
      row,
      { output, settlement: settled },
      {
        maxBytes: this.config.config.tools.artifacts.maxBytes,
        hostFiles: false,
        backgrounded,
        noticeRuns: this.noticeRuns,
        wake: this.runWait,
      },
    );
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
