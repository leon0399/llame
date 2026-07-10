import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantDbService } from '../db/tenant-db.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { QUEUE, type Queue } from '../queue/queue';
import { RunAbortRegistry } from './run-abort-registry';
import {
  RunExecutionService,
  RunNotRunnableError,
} from './run-execution.service';
import {
  heartbeatStaleSeconds,
  RUN_TIMEOUTS_QUEUE,
  RUNS_QUEUE,
  type RunJob,
  type RunTimeoutJob,
} from './run-queues';
import { RunEventsRepository, RunsRepository } from './runs-repository';

function heartbeatIntervalMs(config: ConfigService): number {
  const raw = Number(config.get<string>('RUN_HEARTBEAT_SECONDS'));
  return (Number.isFinite(raw) && raw > 0 ? raw : 15) * 1000;
}

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
 */
@Injectable()
export class RunsWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RunsWorkerService.name);

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly models: ModelsService,
    private readonly runExecution: RunExecutionService,
    private readonly tenantDb: TenantDbService,
    private readonly aborts: RunAbortRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureQueue(RUNS_QUEUE);
    await this.queue.ensureQueue(RUN_TIMEOUTS_QUEUE);
    await this.queue.consume(RUNS_QUEUE, (job) => this.executeJob(job), {
      pollingIntervalSeconds: 0.5,
    });
    await this.queue.consume(
      RUN_TIMEOUTS_QUEUE,
      (job) => this.checkRunLiveness(job),
      { pollingIntervalSeconds: 0.5 },
    );
    this.logger.log(
      `Consuming '${RUNS_QUEUE.name}' + '${RUN_TIMEOUTS_QUEUE.name}'`,
    );
  }

  /**
   * Deadman check (#48 heartbeat + timeout). Runs in the run owner's tenant
   * context — no cross-tenant reaper scan, so the RLS moat stays intact:
   * - terminal run → nothing to do
   * - heartbeat fresh → the worker is alive (long turn); check again later
   * - heartbeat stale → the executing process died or hung: expire the run
   *   (terminal-state immutability in markFinished makes this race-safe
   *   against a late-finishing stream — first writer wins).
   */
  private async checkRunLiveness(job: RunTimeoutJob): Promise<void> {
    const staleMs = heartbeatStaleSeconds(this.config) * 1000;

    const verdict = await this.tenantDb.runAs(job.userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(job.runId, job.userId);
      if (
        !run ||
        ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
      ) {
        return 'done' as const;
      }

      const lastSign = run.heartbeatAt ?? run.startedAt ?? run.createdAt;
      if (Date.now() - lastSign.getTime() < staleMs) {
        return 'alive' as const;
      }

      // markFinished FIRST: it is the atomic terminal-transition claim
      // (finished_at guard) — the event is appended only when this writer
      // won, so a racing finish can't leave a contradictory terminal event.
      const expired = await new RunsRepository(tx).markFinished(
        job.runId,
        job.userId,
        'expired',
        {
          message: 'Run timed out: no worker heartbeat.',
        },
      );
      if (expired) {
        await new RunEventsRepository(tx).append(job.runId, 'run.expired', {
          status: 'expired',
          message: 'Run timed out: no worker heartbeat.',
        });
        this.logger.warn(`Expired run ${job.runId} (stale heartbeat)`);
      }
      return 'done' as const;
    });

    if (verdict === 'alive') {
      await this.queue.enqueue(RUN_TIMEOUTS_QUEUE, job, {
        startAfter: heartbeatStaleSeconds(this.config),
      });
    }
  }

  private async executeJob(job: RunJob): Promise<void> {
    // Pickup gate (#48): a run superseded/expired while queued is already
    // terminal — never resurrect it; one cancelled while queued is settled
    // here without ever touching the model.
    const pickup = await this.tenantDb.runAs(job.userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(job.runId, job.userId);
      if (
        !run ||
        ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
      ) {
        return { skip: true as const };
      }
      // At-least-once delivery: a redelivered job whose run is already
      // executing (fresh heartbeat) must not start a second model call —
      // skip; the live execution settles the run. A STALE running run is the
      // crash-recovery case: proceed, and markStarted refreshes the beat.
      if (run.status === 'running_model') {
        const lastSign = run.heartbeatAt ?? run.startedAt ?? run.createdAt;
        if (
          Date.now() - lastSign.getTime() <
          heartbeatStaleSeconds(this.config) * 1000
        ) {
          this.logger.warn(
            `Skipping redelivered job for live run ${job.runId}`,
          );
          return { skip: true as const };
        }
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
    // Liveness (#48): stamp the heartbeat on an interval while executing, so
    // the deadman check can tell a long turn from a dead worker.
    const heartbeat = setInterval(() => {
      this.tenantDb
        .runAs(job.userId, (tx) =>
          new RunsRepository(tx).touchHeartbeat(job.runId, job.userId),
        )
        .catch((error: unknown) => {
          this.logger.error(
            `Heartbeat failed for run ${job.runId}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
    }, heartbeatIntervalMs(this.config));

    try {
      const result = await this.runExecution.executeRun({
        runId: job.runId,
        chatId: job.chatId,
        userId: job.userId,
        userMessage: job.userMessage,
        client,
        abortSignal: abort.signal,
        // Redelivery may legitimately reclaim a crashed run — but only one
        // consumer can win markStarted's stale-heartbeat CAS.
        reclaimStaleMs: heartbeatStaleSeconds(this.config) * 1000,
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
      clearInterval(heartbeat);
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
