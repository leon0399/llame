import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantDbService } from '../db/tenant-db.service';
import { ModelsService } from '../models/models.service';
import { QUEUE, type Queue } from '../queue/queue';
import { RunAbortRegistry } from './run-abort-registry';
import {
  RunExecutionService,
  type RunUserMessage,
} from './run-execution.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';

export const RUNS_QUEUE = 'runs';

/** Queue payload for one run execution (SPEC §9.5). */
export type RunJob = {
  runId: string;
  chatId: string;
  userId: string;
  userMessage: RunUserMessage;
};

export function runExecutionMode(config: ConfigService): 'inline' | 'worker' {
  return config.get<string>('RUN_EXECUTION_MODE') === 'worker'
    ? 'worker'
    : 'inline';
}

/**
 * RunsWorkerService (#48/#50) — consumes the `runs` queue and drives
 * RunExecutionService, exactly the execution the request thread performs in
 * inline mode. Co-located in the API process for v0.2; the separate worker
 * process split is a later deployment concern, not a code change here.
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
    if (runExecutionMode(this.config) !== 'worker') {
      return;
    }

    await this.queue.ensureQueue(RUNS_QUEUE);
    await this.queue.consume<RunJob>(
      RUNS_QUEUE,
      (job) => this.executeJob(job),
      { pollingIntervalSeconds: 0.5 },
    );
    this.logger.log(`Consuming '${RUNS_QUEUE}' (worker execution mode)`);
  }

  private async executeJob(job: RunJob): Promise<void> {
    // Cancellation at pickup (#48): a run cancelled while still queued is
    // settled without ever touching the model.
    const cancelledEarly = await this.tenantDb.runAs(job.userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(job.runId, job.userId);
      if (!run || run.cancelRequestedAt === null) {
        return false;
      }
      await new RunEventsRepository(tx).append(job.runId, 'run.cancelled', {
        reason: 'cancelled before start',
      });
      await new RunsRepository(tx).markFinished(
        job.runId,
        job.userId,
        'cancelled',
      );
      return true;
    });
    if (cancelledEarly) {
      return;
    }

    // Throws MissingModelCredentialError when absent → the job fails and
    // retries per queue policy, then dead-letters (#47) — never silently lost.
    const credential = await this.models.resolveModelCredential(job.userId);
    const client = this.models.createOpenAIClient(credential);

    // Mid-flight cancellation: the cancel endpoint aborts this controller
    // (same process today); executeRun's abort path records the cancelled
    // terminal state exactly like a client abort did in inline mode.
    const abort = this.aborts.register(job.runId);
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
    } finally {
      this.aborts.unregister(job.runId);
    }
  }
}
