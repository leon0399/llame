import { type Logger } from '@nestjs/common';
import {
  type BashKnownResult,
  type BashResult,
  type BashTimedOutResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopCause,
  type ManagedStopResult,
  type StreamFlags,
} from '@workspace/bash-executor';

import { type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { type BashJobFacts } from './bash-job-registry';
import { appendJobOutput, settleBashJob } from './bash-job-store';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';

type OutputOffsets = Record<'stdout' | 'stderr', number>;

export type JobStopCause = Exclude<ManagedStopCause, 'run' | 'lifetime'>;

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
  unsettled?: { settlement: JobSettlement; output: ManagedOutput };
};

/** Worker-local output buffering and persisted-job settlement lifecycle. */
export class BashJobLifecycle {
  private readonly jobs = new Map<string, LiveJob>();
  private readonly commands = new Set<ManagedBashHandle>();
  private checking = true;

  constructor(
    private readonly tenantDb: TenantRunner,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
  ) {}

  trackCommand(handle: ManagedBashHandle): void {
    this.commands.add(handle);
    void handle.settled.finally(() => this.commands.delete(handle));
  }

  async recheckJobs(): Promise<void> {
    await this.settlePending();

    if (!this.checking) return;

    for (const id of this.jobs.keys()) {
      if (!this.checking) return;

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

  trackJob(
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
    const current = handle.snapshot();
    this.outputArrived(
      live,
      Buffer.byteLength(current.stdout.slice(output.stdout.length)) +
        Buffer.byteLength(current.stderr.slice(output.stderr.length)),
    );

    void handle.settled.then((result) => {
      if (live.completion !== undefined) return;
      live.completion = this.persistCompletion(
        live,
        naturalSettlement(result),
        'stdout' in result ? outputOfResult(result) : handle.snapshot(),
      );
      this.observe(live.completion);
    });
  }

  private outputArrived(live: LiveJob, bytes: number): void {
    if (bytes === 0 || live.completion !== undefined || live.unsettled) return;

    live.pendingBytes += bytes;

    if (live.pendingBytes >= 16 * 1024) this.queueFlush(live);
    else if (live.flushTimer === undefined) {
      live.flushTimer = setTimeout(() => this.queueFlush(live), 1000);
      live.flushTimer.unref();
    }
  }

  private queueFlush(live: LiveJob): void {
    clearTimeout(live.flushTimer);
    live.flushTimer = undefined;

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

  stopChecks(): void {
    this.checking = false;
  }

  async shutdown(): Promise<void> {
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
