import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { QUEUE, type JobState, type Queue } from '../queue/queue';
import { failRunTransactionally } from './run-reply-finalizer';
import { RUNS_QUEUE, runsQueueDefinition, type RunJob } from './run-queues';

/**
 * RunDispatchService (#48/#50) — the publish side of run execution: the queue
 * declaration and the fail-the-run-on-enqueue-failure contract. Owns every
 * queue-facing detail so callers (the chat loop) know nothing about queue
 * names or payload shapes — dispatching a run is one call.
 */
/** The chat send path's view of the publish side: enqueue a committed run and
 *  read that run's job state (#268). */
export type RunDispatcher = Pick<RunDispatchService, 'dispatch' | 'jobState'>;

@Injectable()
export class RunDispatchService {
  private readonly logger = new Logger(RunDispatchService.name);
  private queueReady: Promise<void> | undefined;

  constructor(
    @Inject(QUEUE)
    private readonly queue: Queue,
    private readonly instanceConfig: InstanceConfigService,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * Enqueue a committed run for execution, NAMED BY THE RUN'S OWN ID.
   *
   * Enqueue is NOT transactional with the run row (#48 design constraint 1):
   * pg-boss writes through its own pool, so a crash between the committed run
   * and this call leaves a 'queued' run with no job. Single-flight admission
   * reads that job's state through `jobState` instead of guessing from the
   * run's age, which is what lets it tell "the queue can still execute this
   * run" from "this run is wedged". If that window ever matters, the stronger
   * fix is pg-boss's external-transaction `db` option (enqueue in the run
   * row's txn).
   *
   * On enqueue/bootstrap failure the run is failed in a best-effort
   * transaction (freeing the chat's single-flight slot immediately) and the
   * error is rethrown; the persisted/streamed message stays generic — raw
   * infra errors never egress to the client.
   */
  async dispatch(job: RunJob): Promise<void> {
    try {
      await this.ensureQueues();
      await this.queue.enqueue(RUNS_QUEUE, job, { id: job.runId });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue run ${job.runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      const message = 'Could not queue the run for execution.';
      await failRunTransactionally(
        this.tenantDb,
        job,
        message,
        this.instanceConfig.config.models,
      );
      throw error;
    }
  }

  /**
   * The state of the job this run is named by, for single-flight admission:
   * `queued`/`retrying`/`active` mean the queue can still execute it, and
   * `absent`/`completed`/`failed`/`cancelled` mean it cannot. The payload is
   * never read — the caller only ever learns whether the queue can act.
   */
  jobState(runId: string): Promise<JobState> {
    return this.queue.jobState(RUNS_QUEUE, runId);
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
