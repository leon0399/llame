import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import type { ChangeListener } from '../live/change-listener';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  WorkerProfileService,
  type WorkerConcurrencyResolver,
} from '../instance-config/worker-profile.service';
import { RunAbortRegistry } from './run-abort-registry';
import { parseRunControl, RUN_CONTROL_LISTENER } from './run-control';
import { RunsRepository } from './runs-repository';
import { BashJobRegistry } from '../jobs/bash-job-registry';

/**
 * The run-control listener (run-steering D6): one LISTEN connection per
 * process that consumes `runs`, on `llame_run_control`. postgres.js keeps the
 * connection outside the pool, reconnects with backoff, and calls `onlisten`
 * on every (re)connect.
 *
 * A notification is a pointer. Before it aborts a Run this process executes,
 * the listener reads the Run in its owner's tenant scope and acts only on a
 * recorded cancellation or a Run that no longer exists (Chat deletion). A notification lost while the connection was down is
 * recovered by the same read, over every Run in the registry, on reconnect.
 * An `interrupt` aborts only the segment in flight, and only when the owner has
 * a pending `interrupt` item and the Run still executes the attempt that
 * segment runs; with no model request or tool call in flight, the item waits
 * for the step end.
 */
@Injectable()
export class RunControlListenerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RunControlListenerService.name);
  @Inject(BashJobRegistry)
  private readonly jobs!: Pick<BashJobRegistry, 'recheckJob' | 'recheckJobs'>;

  constructor(
    @Inject(RUN_CONTROL_LISTENER)
    private readonly listener: ChangeListener,
    @Inject(WorkerProfileService)
    private readonly workerProfile: WorkerConcurrencyResolver,
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(RunAbortRegistry)
    private readonly aborts: RunAbortRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // A process that does not consume `runs` executes none, so it has nothing
    // to stop.
    if (this.workerProfile.concurrencyFor('runs') === null) return;
    await this.listener.listen(
      (raw) => void this.onNotify(raw),
      () => void this.recheckExecuting(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.listener.close();
  }

  private async onNotify(raw: string): Promise<void> {
    const message = parseRunControl(raw);

    if (!message) {
      this.logger.warn('Dropped malformed run-control notification');

      return;
    }

    if (message.kind === 'job-stop') {
      await this.jobs
        .recheckJob(message.jobId)
        .catch(() => this.logger.warn('Job-control check failed.'));

      return;
    }

    const userId = this.aborts.ownerOf(message.runId);

    if (userId === undefined) return;

    if (message.kind === 'cancel') {
      await this.abortIfCancelled(message.runId, userId);
    } else if (message.kind === 'steer') {
      await this.yieldIfPending(message.runId, userId);
    } else {
      await this.interruptIfPending(message.runId, userId);
    }
  }

  private async recheckExecuting(): Promise<void> {
    // Independent of the Run checks: a slow job check must not delay them.
    const jobs = this.jobs
      .recheckJobs()
      .catch(() => this.logger.warn('Job-control reconnect check failed.'));

    for (const { runId, userId } of this.aborts.executing()) {
      await this.abortIfCancelled(runId, userId);
      await this.interruptIfPending(runId, userId);
      await this.yieldIfPending(runId, userId);
    }

    await jobs;
  }

  /**
   * Stops the segment in flight when the owner's read shows a pending
   * `interrupt` item and the Run still names the attempt that segment runs. A
   * segment of another attempt, or none in flight, leaves the item for the
   * step end or the final answer.
   */
  private async interruptIfPending(
    runId: string,
    userId: string,
  ): Promise<void> {
    const attemptId = this.aborts.segmentAttemptOf(runId);

    if (attemptId === undefined) return;

    try {
      const pending = await this.tenantDb.runAs(userId, async (tx) => {
        const run = await new RunsRepository(tx).findById(runId, userId);

        return (
          run?.activeAttemptId === attemptId &&
          (await new ChatDeliveriesRepository(tx).hasPendingInterrupt(
            run.chatId,
            userId,
          ))
        );
      });

      if (pending) this.aborts.interrupt(runId, attemptId);
    } catch (error) {
      this.logger.warn(
        `Run-control interrupt check failed for run ${runId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Raises the yield signal of the segment in flight when the owner's read
   * shows a pending `steer` or `interrupt` item and the Run still names the
   * attempt that segment runs. It never aborts: a call that can continue as a
   * job returns, and the step end delivers the item.
   */
  private async yieldIfPending(runId: string, userId: string): Promise<void> {
    const attemptId = this.aborts.segmentAttemptOf(runId);

    if (attemptId === undefined) return;

    try {
      const pending = await this.tenantDb.runAs(userId, async (tx) => {
        const run = await new RunsRepository(tx).findById(runId, userId);

        return (
          run?.activeAttemptId === attemptId &&
          (await new ChatDeliveriesRepository(tx).hasPendingSteering(
            run.chatId,
            userId,
          ))
        );
      });

      if (pending) this.aborts.yield(runId, attemptId);
    } catch (error) {
      this.logger.warn(
        `Run-control steer check failed for run ${runId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Aborts when the owner's read shows a recorded cancellation or no Run. */
  private async abortIfCancelled(runId: string, userId: string): Promise<void> {
    try {
      const run = await this.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(runId, userId),
      );

      // A superseded Run is settled `cancelled` without a cancel request, and
      // a deleted Chat cascades its Run away: a Run that this process executes
      // and the owner can no longer read has been cancelled by that deletion.
      if (
        !run ||
        run.cancelRequestedAt !== null ||
        run.status === 'cancelled'
      ) {
        this.aborts.abort(runId);
      }
    } catch (error) {
      this.logger.warn(
        `Run-control check failed for run ${runId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
