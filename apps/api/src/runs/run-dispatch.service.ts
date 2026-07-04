import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantDbService } from '../db/tenant-db.service';
import { QUEUE, type Queue } from '../queue/queue';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  RUNS_QUEUE,
  RUN_TIMEOUTS_QUEUE,
  runTimeoutSeconds,
  type RunJob,
} from './runs-worker.service';

/**
 * RunDispatchService (#48/#50) — the publish side of run execution: queue
 * declarations, the run job + its per-run deadman timeout job, and the
 * fail-the-run-on-enqueue-failure contract. Owns every queue-facing detail so
 * callers (the chat loop) know nothing about queue names, payload shapes, or
 * scheduling — dispatching a run is one call.
 */
@Injectable()
export class RunDispatchService {
  private readonly logger = new Logger(RunDispatchService.name);
  private queueReady: Promise<void> | undefined;

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * Enqueue a committed run for execution, plus its deadman timeout job.
   *
   * Enqueue is NOT transactional with the run row (#48 design constraint 1):
   * pg-boss writes through its own pool, so a crash between the committed run
   * and this call leaves a 'queued' run with no job. That state self-heals: a
   * same-message retry supersedes it, and a different message expires it via
   * the stale-heartbeat unwedge (createdAt counts as the last sign of life
   * for a never-started run). If those windows ever matter, the fix is
   * pg-boss's external-transaction `db` option.
   *
   * On enqueue/bootstrap failure the run is failed in a best-effort
   * transaction (freeing the chat's single-flight slot immediately) and the
   * error is rethrown; the persisted/streamed message stays generic — raw
   * infra errors never egress to the client.
   */
  async dispatch(job: RunJob): Promise<void> {
    try {
      await this.ensureQueues();
      // The two enqueues are independent (no ordering requirement — a timeout
      // job for a run whose job enqueue failed just expires the orphan
      // sooner), so they run in parallel.
      await Promise.all([
        this.queue.enqueue<RunJob>(RUNS_QUEUE, job),
        this.queue.enqueue(
          RUN_TIMEOUTS_QUEUE,
          { runId: job.runId, userId: job.userId },
          { startAfter: runTimeoutSeconds(this.config) },
        ),
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue run ${job.runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      const message = 'Could not queue the run for execution.';
      await this.tenantDb.runAs(job.userId, async (tx) => {
        const failed = await new RunsRepository(tx).markFinished(
          job.runId,
          job.userId,
          'failed',
          { message },
        );
        if (failed) {
          await new RunEventsRepository(tx).append(job.runId, 'run.failed', {
            status: 'failed',
            message,
          });
        }
      });
      throw error;
    }
  }

  /** Publisher-side queue declarations, once per process (idempotent upsert). */
  private ensureQueues(): Promise<void> {
    this.queueReady ??= Promise.all([
      this.queue.ensureQueue(RUNS_QUEUE),
      this.queue.ensureQueue(RUN_TIMEOUTS_QUEUE),
    ])
      .then(() => undefined)
      .catch((error: unknown) => {
        // Never cache a rejection: the next dispatch retries the bootstrap.
        this.queueReady = undefined;
        throw error;
      });
    return this.queueReady;
  }
}
