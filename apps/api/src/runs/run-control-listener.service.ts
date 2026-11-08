import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres, { type Sql } from 'postgres';

import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  WorkerProfileService,
  type WorkerConcurrencyResolver,
} from '../instance-config/worker-profile.service';
import { RunAbortRegistry } from './run-abort-registry';
import { parseRunControl, RUN_CONTROL_CHANNEL } from './run-control';
import { RunsRepository } from './runs-repository';

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
 * `interrupt` is accepted and ignored until the interrupt layer handles it.
 */
@Injectable()
export class RunControlListenerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RunControlListenerService.name);
  private client: Sql | undefined;

  constructor(
    @Inject(ConfigService)
    private readonly config: Pick<ConfigService, 'get' | 'getOrThrow'>,
    @Inject(WorkerProfileService)
    private readonly workerProfile: WorkerConcurrencyResolver,
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(RunAbortRegistry)
    private readonly aborts: RunAbortRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // A process that does not consume `runs` executes none, so it has nothing
    // to stop. Offline OpenAPI generation boots AppModule against no database.
    if (this.workerProfile.concurrencyFor('runs') === null) return;
    if (this.config.get<string>('LLAME_OPENAPI_GENERATION') === '1') return;
    this.client = postgres(this.config.getOrThrow<string>('POSTGRES_URL'), {
      max: 1,
    });
    await this.client.listen(
      RUN_CONTROL_CHANNEL,
      (raw) => void this.onNotify(raw),
      () => void this.recheckExecuting(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.end({ timeout: 5 });
  }

  private async onNotify(raw: string): Promise<void> {
    const message = parseRunControl(raw);
    if (!message) {
      this.logger.warn('Dropped malformed run-control notification');
      return;
    }
    if (message.kind !== 'cancel') return;
    const userId = this.aborts.ownerOf(message.runId);
    if (userId === undefined) return;
    await this.abortIfCancelled(message.runId, userId);
  }

  private async recheckExecuting(): Promise<void> {
    for (const { runId, userId } of this.aborts.executing()) {
      await this.abortIfCancelled(runId, userId);
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
