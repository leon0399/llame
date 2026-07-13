import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { QUEUE, type Queue } from '../queue/queue';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RUNS_QUEUE, runsQueueDefinition, type RunJob } from './run-queues';

/**
 * RunDispatchService (#48/#50) — the publish side of run execution: the queue
 * declaration and the fail-the-run-on-enqueue-failure contract. Owns every
 * queue-facing detail so callers (the chat loop) know nothing about queue
 * names or payload shapes — dispatching a run is one call.
 */
@Injectable()
export class RunDispatchService {
  private readonly logger = new Logger(RunDispatchService.name);
  private queueReady: Promise<void> | undefined;

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly instanceConfig: InstanceConfigService,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * Enqueue a committed run for execution.
   *
   * Enqueue is NOT transactional with the run row (#48 design constraint 1):
   * pg-boss writes through its own pool, so a crash between the committed run
   * and this call leaves a 'queued' run with no job. The queue can only
   * recover an ACTIVE job (worker-death heartbeat → retry → dead-letter), so
   * it cannot free this orphan — that is exactly why chat-loop's single-flight
   * path expires a blocker whose last sign of life is older than the longest a
   * real run could take (`timeoutSeconds + heartbeatSeconds`): a next message
   * to the chat unwedges it. If that window ever matters, the stronger fix is
   * pg-boss's external-transaction `db` option (enqueue in the run row's txn).
   *
   * On enqueue/bootstrap failure the run is failed in a best-effort
   * transaction (freeing the chat's single-flight slot immediately) and the
   * error is rethrown; the persisted/streamed message stays generic — raw
   * infra errors never egress to the client.
   */
  async dispatch(job: RunJob): Promise<void> {
    try {
      await this.ensureQueues();
      await this.queue.enqueue(RUNS_QUEUE, job);
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

  /** Publisher-side queue declaration, once per process (idempotent upsert). */
  private ensureQueues(): Promise<void> {
    this.queueReady ??= this.queue
      .ensureQueue(runsQueueDefinition(this.instanceConfig.config))
      .catch((error: unknown) => {
        // Never cache a rejection: the next dispatch retries the bootstrap.
        this.queueReady = undefined;
        throw error;
      });
    return this.queueReady;
  }
}
