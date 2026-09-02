import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { type Run } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  WorkerProfileService,
  type WorkerConcurrencyResolver,
} from '../instance-config/worker-profile.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
  type ModelClientFactory,
} from '../models/models.service';
import { deadLetterQueue, QUEUE, type QueueConsumer } from '../queue/queue';
import { RunAbortRegistry, type RunAbortRegistrar } from './run-abort-registry';
import { ModelContextExecutionError } from './snapshot-tool-execution';
import {
  RUN_TIMEOUT_ABORT_REASON,
  RunExecutionService,
  RunNotRunnableError,
  type RunExecutor,
} from './run-execution.service';
import {
  runsQueueDefinition,
  runTimeoutSeconds,
  RUNS_QUEUE,
  type RunJob,
} from './run-queues';
import { RunsRepository, failRunTransactionally } from './runs-repository';
import {
  CanonicalSearchCoverageService,
  type CanonicalSearchCoverageGate,
} from '../search/canonical-search-activation.service';

const RUNS_DEAD_QUEUE = deadLetterQueue(RUNS_QUEUE);

const TERMINAL_RUN_STATUSES: ReadonlySet<Run['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

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
    @Inject(QUEUE)
    private readonly queue: QueueConsumer,
    // Each annotation below carries no DI metadata of its own (#268 — the
    // narrow capability type erases to `Object` at runtime), so the token is
    // explicit.
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(WorkerProfileService)
    private readonly workerProfile: WorkerConcurrencyResolver,
    @Inject(CanonicalSearchCoverageService)
    private readonly canonicalSearchCoverage: CanonicalSearchCoverageGate,
    @Inject(ModelsService)
    private readonly models: ModelClientFactory,
    @Inject(RunExecutionService)
    private readonly runExecution: RunExecutor,
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(RunAbortRegistry)
    private readonly aborts: RunAbortRegistrar,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Worker-profile gate (durable-run-workers D2/D3): a process whose active
    // profile doesn't include the `runs` group registers NOTHING for it — not
    // even at concurrency 1 (e.g. an api process running the `web` profile).
    const concurrency = this.workerProfile.concurrencyFor('runs');
    if (concurrency === null) {
      return;
    }
    await this.canonicalSearchCoverage.assertReady();
    await this.queue.ensureQueue(
      runsQueueDefinition(this.instanceConfig.config),
    );
    await this.queue.consume(RUNS_QUEUE, (job) => this.executeJob(job), {
      pollingIntervalSeconds: 0.5,
      concurrency,
    });
    // Retry-exhaustion terminal expiry (design D7 mechanism 3): the DLQ
    // ensureQueue() already provisions (`deadLetter: true` by default) —
    // purely additive, nothing consumed it before this change. Runs at the
    // group's fixed internal concurrency (1) — the operator tunes only the
    // main queue.
    await this.queue.consume(RUNS_DEAD_QUEUE, (job) =>
      this.expireDeadLetteredRun(job),
    );
    this.logger.log(
      `Consuming '${RUNS_QUEUE.name}' (+ its dead-letter queue) at concurrency ${concurrency}`,
    );
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
    const settlement = await this.runExecution.settleTerminalRun({
      runId: job.runId,
      userId: job.userId,
      status: 'expired',
      runPayload: { status: 'expired', message },
      error: { message },
    });
    if (settlement.outcome === 'won') {
      this.logger.warn(`Expired run ${job.runId} (retries exhausted)`);
    }
  }

  private async executeJob(job: RunJob): Promise<void> {
    // Pickup gate (#48): a run superseded/expired while queued is already
    // terminal — never resurrect it; one cancelled while queued is settled
    // here without ever touching the model. A run already at running_model
    // is NOT special-cased here (durable-run-workers D7): with the queue's
    // native heartbeatSeconds set, a redelivery only ever happens after the
    // prior holder stopped beating, so any non-terminal run is a legitimate
    // claim to attempt. markStarted (in executeRun) is the final guard and
    // also rejects cancellation that wins this pickup/claim TOCTOU.
    const pickup = await this.tenantDb.runAs(job.userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(job.runId, job.userId);
      if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
        return { skip: true as const, settleCancellation: false as const };
      }
      if (run.cancelRequestedAt === null) {
        return { skip: false as const, modelId: run.modelId };
      }
      return { skip: true as const, settleCancellation: true as const };
    });
    if (pickup.skip && pickup.settleCancellation) {
      await this.settleCancelledBeforeStart(job);
    }
    if (pickup.skip) {
      return;
    }

    let client: ReturnType<ModelsService['createClient']>;
    try {
      client = this.models.createClient(pickup.modelId);
    } catch (error) {
      if (
        error instanceof ModelNotAvailableError ||
        error instanceof ModelConfigurationError
      ) {
        await failRunTransactionally(this.tenantDb, job, error.message);
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
      await this.settleCancelledBeforeStart(job);
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

      // The AI SDK can resolve stream consumption after swallowing an async
      // tool callback rejection. Treat a resolved drain as successful only
      // when the durable owner-scoped run agrees. Otherwise the queue must
      // retry; acknowledging here would strand the run as nonterminal forever.
      const persisted = await this.tenantDb.runAs(job.userId, (tx) =>
        new RunsRepository(tx).findById(job.runId, job.userId),
      );
      if (persisted && !TERMINAL_RUN_STATUSES.has(persisted.status)) {
        throw new Error(
          `Run ${job.runId} stream drained without a durable terminal state.`,
        );
      }
    } catch (error) {
      // The run went terminal before execution could claim it (superseded,
      // cancelled, expired): already settled durably — the job is done, not
      // failed. A model-context preparation error is also run-level only when
      // its terminal write is observable; finishRun deliberately reports DB
      // write errors without replacing the original exception, so the worker
      // must verify durable state before suppressing the queue retry. Anything
      // else is an infrastructure failure → queue retry.
      if (error instanceof RunNotRunnableError) {
        this.logger.warn(`Run ${job.runId} was terminal at claim; skipping`);
        return;
      }
      if (
        error instanceof ModelContextExecutionError &&
        (await this.isRunSettledDurably(job))
      ) {
        this.logger.warn(
          `Run ${job.runId} has incompatible bound model context; already failed durably`,
        );
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeoutTimer);
      this.aborts.unregister(job.runId);
    }
  }

  /** Has this job's run already reached a terminal state, durably? */
  private async isRunSettledDurably(job: RunJob): Promise<boolean> {
    const persisted = await this.tenantDb.runAs(job.userId, (tx) =>
      new RunsRepository(tx).findById(job.runId, job.userId),
    );
    return (
      persisted !== undefined && TERMINAL_RUN_STATUSES.has(persisted.status)
    );
  }

  private async settleCancelledBeforeStart(job: RunJob): Promise<void> {
    const message = 'Run was cancelled before this worker attempt started.';
    await this.runExecution.settleTerminalRun({
      runId: job.runId,
      userId: job.userId,
      status: 'cancelled',
      runPayload: { status: 'cancelled', message },
      error: { message },
    });
  }
}
