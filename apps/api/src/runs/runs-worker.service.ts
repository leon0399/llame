import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { deadLetterQueue, QUEUE, type Queue } from '../queue/queue';
import { RunAbortRegistry } from './run-abort-registry';
import {
  RUN_TIMEOUT_ABORT_REASON,
  RunExecutionService,
  RunNotRunnableError,
} from './run-execution.service';
import {
  runsQueueDefinition,
  runTimeoutSeconds,
  RUNS_QUEUE,
  type RunJob,
} from './run-queues';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const RUNS_DEAD_QUEUE = deadLetterQueue(RUNS_QUEUE);

/**
 * RunsWorkerService (#48/#50) — consumes the `runs` queue and drives
 * RunExecutionService. This is the ONLY execution path (no inline mode).
 * Co-located in the API process for v0.2; the separate worker entrypoint
 * that scales M independently of api replicas is #116.
 *
 * Failure contract: a run-level failure (model error) is recorded durably by
 * executeRun (run.failed + status) and the queue job still succeeds — retrying
 * it would re-run a turn whose failure is already the source of truth. Queue
 * retries + dead-lettering (#47 defaults) apply to infrastructure failures:
 * credential resolution, DB unavailability, a thrown executeRun.
 *
 * Liveness (durable-run-workers D7): a run's continued life is no longer
 * tracked by an app-level heartbeat/deadman — it is the composition of three
 * mechanisms: (1) an in-process wall-clock abort here (executeJob), (2) the
 * `runs` queue's native worker-liveness (heartbeatSeconds, set via
 * runsQueueDefinition — pg-boss auto-refreshes it and fails+retries the job
 * if the beat lapses, so a healthy worker re-executes a crashed run), and (3)
 * the `runs.dead` consumer below for retry exhaustion.
 */
@Injectable()
export class RunsWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RunsWorkerService.name);

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly instanceConfig: InstanceConfigService,
    private readonly models: ModelsService,
    private readonly runExecution: RunExecutionService,
    private readonly tenantDb: TenantDbService,
    private readonly aborts: RunAbortRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureQueue(
      runsQueueDefinition(this.instanceConfig.config),
    );
    await this.queue.consume(RUNS_QUEUE, (job) => this.executeJob(job), {
      pollingIntervalSeconds: 0.5,
    });
    // Retry-exhaustion terminal expiry (design D7 mechanism 3): the DLQ
    // ensureQueue() already provisions (`deadLetter: true` by default) —
    // purely additive, nothing consumed it before this change.
    await this.queue.consume(RUNS_DEAD_QUEUE, (job) =>
      this.expireDeadLetteredRun(job),
    );
    this.logger.log(`Consuming '${RUNS_QUEUE.name}' (+ its dead-letter queue)`);
  }

  /**
   * Retry-exhaustion terminal expiry (design D7 mechanism 3): a run whose job
   * kept killing its worker until the queue's retry policy exhausted lands
   * here via `runs.dead`, carrying the original job payload. Settled to a
   * terminal run.expired in the run OWNER's tenant scope — no cross-tenant
   * scan. markFinished's first-writer-wins guard means a run that somehow
   * already reached a terminal state (e.g. a healthy retry actually finished
   * it before the DLQ handler ran) is left untouched — this only ever writes
   * the FIRST terminal outcome.
   */
  private async expireDeadLetteredRun(job: RunJob): Promise<void> {
    const message =
      'Run retries exhausted: the worker repeatedly failed to complete it.';
    await this.tenantDb.runAs(job.userId, async (tx) => {
      const expired = await new RunsRepository(tx).markFinished(
        job.runId,
        job.userId,
        'expired',
        { message },
      );
      if (expired) {
        await new RunEventsRepository(tx).append(job.runId, 'run.expired', {
          status: 'expired',
          message,
        });
        this.logger.warn(`Expired run ${job.runId} (retries exhausted)`);
      }
    });
  }

  private async executeJob(job: RunJob): Promise<void> {
    // Pickup gate (#48): a run superseded/expired while queued is already
    // terminal — never resurrect it; one cancelled while queued is settled
    // here without ever touching the model. A run already at running_model
    // is NOT special-cased here (durable-run-workers D7): with the queue's
    // native heartbeatSeconds set, a redelivery only ever happens after the
    // prior holder stopped beating, so any non-terminal run is a legitimate
    // claim to attempt — markStarted (in executeRun) is the actual guard.
    const pickup = await this.tenantDb.runAs(job.userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(job.runId, job.userId);
      if (
        !run ||
        ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
      ) {
        return { skip: true as const };
      }
      if (run.cancelRequestedAt === null) {
        return { skip: false as const, modelId: run.modelId };
      }
      const cancelled = await new RunsRepository(tx).markFinished(
        job.runId,
        job.userId,
        'cancelled',
      );
      if (cancelled) {
        await new RunEventsRepository(tx).append(job.runId, 'run.cancelled', {
          reason: 'cancelled before start',
        });
      }
      return { skip: true as const };
    });
    if (pickup.skip) {
      return;
    }

    let client: ReturnType<ModelsService['createOpenAIClient']>;
    try {
      client = this.models.createOpenAIClient({
        credential: this.models.getOpenAIProviderCredential(),
        modelId: pickup.modelId,
      });
    } catch (error) {
      if (
        error instanceof ModelNotAvailableError ||
        error instanceof ModelConfigurationError
      ) {
        await this.failRun(job, error.message);
        return;
      }
      throw error;
    }

    // Mid-flight cancellation: the cancel endpoint aborts this controller
    // (same process today); executeRun's abort path records the cancelled
    // terminal state exactly like a client abort did in inline mode.
    const abort = this.aborts.register(job.runId);

    // Close the pickup TOCTOU (review finding): a cancel landing after the
    // skip-gate read but before the registration above stamped the DB and
    // found no controller to abort. Re-check now that we are registered —
    // any later cancel hits the live controller instead.
    const cancelledMeanwhile = await this.tenantDb.runAs(
      job.userId,
      async (tx) => {
        const run = await new RunsRepository(tx).findById(
          job.runId,
          job.userId,
        );
        return run?.cancelRequestedAt != null;
      },
    );
    if (cancelledMeanwhile) {
      this.aborts.unregister(job.runId);
      await this.tenantDb.runAs(job.userId, async (tx) => {
        const cancelled = await new RunsRepository(tx).markFinished(
          job.runId,
          job.userId,
          'cancelled',
        );
        if (cancelled) {
          await new RunEventsRepository(tx).append(job.runId, 'run.cancelled', {
            reason: 'cancelled before start',
          });
        }
      });
      return;
    }

    // In-process wall-clock abort (design D7 mechanism 1): while THIS worker
    // is alive, a run exceeding its budget is aborted here and tagged with
    // RUN_TIMEOUT_ABORT_REASON so RunExecutionService (classifyAbortedRun)
    // records a terminal run.expired instead of the run.cancelled a genuine
    // user cancel produces on the exact same AbortController/signal. No queue
    // job involved — a healthy worker kills its own overrun.
    const timeoutMs = runTimeoutSeconds(this.instanceConfig.config) * 1000;
    const timeoutTimer = setTimeout(() => {
      abort.abort(RUN_TIMEOUT_ABORT_REASON);
    }, timeoutMs);

    try {
      const result = await this.runExecution.executeRun({
        runId: job.runId,
        chatId: job.chatId,
        userId: job.userId,
        userMessage: job.userMessage,
        client,
        abortSignal: abort.signal,
      });

      // Drain the stream — executeRun's callbacks persist the assistant turn,
      // delta events, and the terminal run status as a side effect.
      await (result.consumeStream ? result.consumeStream() : result.text);
    } catch (error) {
      // The run went terminal before execution could claim it (superseded,
      // cancelled, expired): already settled durably — the job is done, not
      // failed. Anything else is an infrastructure failure → queue retry.
      if (error instanceof RunNotRunnableError) {
        this.logger.warn(`Run ${job.runId} was terminal at claim; skipping`);
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeoutTimer);
      this.aborts.unregister(job.runId);
    }
  }

  private async failRun(job: RunJob, message: string): Promise<void> {
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
  }
}
