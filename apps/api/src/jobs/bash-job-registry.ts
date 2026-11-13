import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  startManagedBash,
  type BashCommandInput,
  type BashExecutorContext,
  type BashKnownResult,
  type BashResult,
  type BashUnavailableResult,
  type BashTimedOutResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopCause,
  type ManagedStopResult,
  type StartManagedBashOptions,
  type StreamFlags,
} from '@workspace/bash-executor';

import { type ChatDeliverySettings, type ChatJob } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { reserveArtifactSeq } from '../tools/artifacts/artifact-writer';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { appendJobOutput, settleBashJob } from './bash-job-store';
import { JobPromotionError } from './job-promotion-error';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

type JobStopCause = Exclude<ManagedStopCause, 'run' | 'lifetime'>;

type OutputOffsets = Record<'stdout' | 'stderr', number>;

export type BashJobFacts = {
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly startedAt: Date;
  readonly settings: ChatDeliverySettings;
  readonly maxBytes: number;
  readonly configuredCredentials: ReadonlyArray<string>;
  readonly artifactReadable: boolean;
  readonly hostFiles: boolean;
  readonly unlimited?: boolean;
};

type LiveJob = {
  readonly handle: ManagedBashHandle;
  readonly row: ChatJob;
  readonly facts: BashJobFacts;
  offsets: OutputOffsets;
  pendingBytes: number;
  flushTimer?: NodeJS.Timeout;
  flushQueued: boolean;
  unsubscribe: () => void;
  writes: Promise<void>;
  completion?: Promise<void>;
  /** The facts of a settlement that failed to commit; `settlePending` retries them. */
  unsettled?: { settlement: JobSettlement; output: ManagedOutput };
};

/** Worker-local authority over handles; stored jobs are readable on any worker. */
@Injectable()
export class BashJobRegistry implements OnModuleInit {
  private readonly logger = new Logger(BashJobRegistry.name);
  private accepting = true;
  private readonly commands = new Set<ManagedBashHandle>();
  private readonly jobs = new Map<string, LiveJob>();
  private readonly promotions = new Set<Promise<ChatJob>>();

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
  ) {}

  onModuleInit(): void {
    this.worker.jobCheck = () => this.recheckJobs();
  }

  async recheckJobs(): Promise<void> {
    if (!this.accepting) return;

    await this.settlePending();

    if (!this.accepting) return;

    // One job's failed check must not starve the stop signals of the others.
    for (const id of this.jobs.keys()) {
      await this.recheckJob(id).catch((error: unknown) =>
        this.logger.warn(`Job check failed: ${String(error)}`),
      );
    }
  }

  async recheckJob(jobId: string): Promise<void> {
    const live = this.jobs.get(jobId);

    if (live === undefined) return;

    const row = await this.tenantDb.runAs(live.facts.ownerUserId, (db) =>
      new ChatJobsRepository(db).findById(
        live.row.chatId,
        live.facts.ownerUserId,
        jobId,
      ),
    );

    if (row === undefined) await this.stop(jobId, 'owner');
    else if (row.stopRequestedBy !== null)
      await this.stop(jobId, row.stopRequestedBy);
    else if (row.state !== 'running') await this.stop(jobId, 'worker');
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

    if ('pid' in handle) {
      this.commands.add(handle);
      void handle.settled.finally(() => this.commands.delete(handle));
    }

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

      this.trackJob(handle, row, facts, output);

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

  private trackJob(
    handle: ManagedBashHandle,
    row: ChatJob,
    facts: BashJobFacts,
    output: ManagedOutput,
  ): void {
    const live: LiveJob = {
      handle,
      row,
      facts,
      offsets: { stdout: output.stdout.length, stderr: output.stderr.length },
      pendingBytes: 0,
      flushQueued: false,
      writes: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    this.jobs.set(row.id, live);
    this.commands.delete(handle);
    live.unsubscribe = handle.onOutput((bytes) =>
      this.outputArrived(live, bytes),
    );
    // Include bytes produced while the promotion transaction was in flight.
    const current = handle.snapshot();
    this.outputArrived(
      live,
      Buffer.byteLength(current.stdout.slice(output.stdout.length)) +
        Buffer.byteLength(current.stderr.slice(output.stderr.length)),
    );

    void handle.settled.then((result) => {
      if (live.completion === undefined) {
        live.completion = this.persistCompletion(
          live,
          naturalSettlement(result),
          'stdout' in result ? outputOfResult(result) : handle.snapshot(),
        );
        this.observe(live.completion);
      }
    });
  }

  private outputArrived(live: LiveJob, bytes: number): void {
    if (bytes === 0 || live.completion !== undefined || live.unsettled) return;
    live.pendingBytes += bytes;

    if (live.pendingBytes >= 16 * 1024) {
      this.queueFlush(live);
    } else if (live.flushTimer === undefined) {
      live.flushTimer = setTimeout(() => this.queueFlush(live), 1000);
      live.flushTimer.unref();
    }
  }

  private queueFlush(live: LiveJob): void {
    clearTimeout(live.flushTimer);
    live.flushTimer = undefined;

    // Keep at most one future flush; capture its output only when it can write.
    if (live.flushQueued) return;
    live.flushQueued = true;
    live.writes = live.writes
      .catch(() => undefined)
      .then(async () => {
        live.flushQueued = false;
        clearTimeout(live.flushTimer);
        live.flushTimer = undefined;
        live.pendingBytes = 0;
        const snapshot = live.handle.snapshot();
        await this.tenantDb.runAs(live.facts.ownerUserId, (db) =>
          appendJobOutput(db, live.row, snapshot, live.offsets),
        );
        live.offsets = {
          stdout: snapshot.stdout.length,
          stderr: snapshot.stderr.length,
        };
      });
    this.observe(live.writes);
  }

  async stop(jobId: string, cause: JobStopCause): Promise<void> {
    const live = this.jobs.get(jobId);

    if (live === undefined) return;

    if (live.completion !== undefined) return live.completion;

    if (live.unsettled !== undefined) return this.retryUnsettled(live);
    // Claim before stop resolves: its settled promise fires before stop returns.
    live.completion = this.stopAndSettle(live, cause);

    return live.completion;
  }

  private async stopAndSettle(
    live: LiveJob,
    cause: JobStopCause,
  ): Promise<void> {
    const output = await live.handle.stop(cause);
    const result = await live.handle.settled;
    await this.persistCompletion(
      live,
      'type' in result && result.type === 'timed_out'
        ? naturalSettlement(result)
        : stoppedSettlement(cause, output),
      output,
    );
  }

  private async persistCompletion(
    live: LiveJob,
    settlement: JobSettlement,
    output: ManagedOutput,
  ): Promise<void> {
    clearTimeout(live.flushTimer);
    live.unsubscribe();
    // A failed periodic flush leaves offsets unchanged; settlement still stores it.
    await live.writes.catch(() => undefined);

    try {
      await settleBashJob(
        this.tenantDb,
        live.row,
        { output, settlement, offsets: live.offsets },
        live.facts,
      );
      this.jobs.delete(live.row.id);
    } catch (error) {
      // The process is gone but the row is not settled. Keep the facts: the
      // heartbeat's recheck calls `settlePending` until they commit, and the
      // lost-on-touch join settles the row if this worker ends first (D9).
      live.unsettled = { settlement, output };
      live.completion = undefined;
      throw error;
    }
  }

  private retryUnsettled(live: LiveJob): Promise<void> {
    const pending = live.unsettled;

    if (pending === undefined) return Promise.resolve();
    live.unsettled = undefined;
    live.completion = this.persistCompletion(
      live,
      pending.settlement,
      pending.output,
    );

    return live.completion;
  }

  /**
   * Retry every settlement that failed to commit. The worker's heartbeat check
   * calls it; a job that settles leaves the registry, and one that fails again
   * stays pending. It never stops a running command.
   */
  async settlePending(): Promise<void> {
    const pending = [...this.jobs.values()].filter(
      (live) => live.unsettled !== undefined && live.completion === undefined,
    );

    const outcomes = await Promise.allSettled(
      pending.map((live) => this.retryUnsettled(live)),
    );

    for (const outcome of outcomes)
      if (outcome.status === 'rejected')
        this.logger.warn(
          `Pending job settlement still failing: ${String(outcome.reason)}`,
        );
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    this.worker.jobCheck = undefined;
    await Promise.allSettled(this.promotions);

    const stopped = await Promise.allSettled([
      ...[...this.jobs.keys()].map((id) => this.stop(id, 'worker')),
      ...[...this.commands].map((handle) => handle.stop('worker')),
    ]);

    for (const outcome of stopped)
      if (outcome.status === 'rejected')
        this.logger.error(
          `Stopping a command at shutdown failed: ${String(outcome.reason)}`,
        );
  }

  private observe(work: Promise<void>): void {
    void work.catch((error: unknown) =>
      this.logger.error(`Background job persistence failed: ${String(error)}`),
    );
  }
}

function naturalSettlement(result: BashResult): JobSettlement {
  if ('exitCode' in result)
    return {
      state:
        result.exitCode === 0 && result.signal == null ? 'succeeded' : 'failed',
      result: {
        // A signal ends the child with no exit code; the executor's 1 is a stand-in.
        exitCode: result.signal == null ? result.exitCode : null,
        signal: result.signal,
        truncated: result.truncatedStreams ?? bothStreams(result.truncated),
      },
    };

  if (result.type === 'timed_out')
    return {
      state: 'timed_out',
      result: {
        truncated: result.truncatedStreams ?? bothStreams(result.truncated),
      },
    };

  return { state: 'lost', result: { outcomeUnknown: true } };
}

function outputOfResult(
  result: BashKnownResult | BashTimedOutResult,
): ManagedOutput {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    truncatedStreams: result.truncatedStreams ?? bothStreams(result.truncated),
  };
}

function bothStreams(flag: boolean): StreamFlags {
  return { stdout: flag, stderr: flag };
}

function stoppedSettlement(
  cause: JobStopCause,
  output: ManagedStopResult,
): JobSettlement {
  const result = { truncated: output.truncatedStreams };

  if (!output.proved)
    return { state: 'lost', result: { ...result, outcomeUnknown: true } };

  return { state: 'cancelled', stoppedBy: cause, result };
}
