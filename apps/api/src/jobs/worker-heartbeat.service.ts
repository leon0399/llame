import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import { workerInstances } from '../db/schema';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { heartbeatSeconds } from '../runs/run-queues';
import {
  WorkerProfileService,
  type WorkerConcurrencyResolver,
} from '../instance-config/worker-profile.service';

/**
 * The heartbeat of one worker process (background-jobs D9). The process takes a
 * random id at each start, so a restarted process never revives the jobs of its
 * earlier life, and it upserts its `worker_instances` row every
 * `runs.heartbeatSeconds`. A worker with no heartbeat for four intervals is
 * dead, and the jobs on it settle as `lost` at their next touch.
 *
 * Only a process that consumes `runs` hosts jobs, so a process whose profile
 * lacks that group records no heartbeat.
 */
@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);

  /** The identity of this process; new at each start. */
  readonly instanceId = randomUUID();

  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject('DB_DEV')
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(WorkerProfileService)
    private readonly workerProfile: WorkerConcurrencyResolver,
  ) {}

  /** Before any consumer starts, so no job can name a worker with no row. */
  async onModuleInit(): Promise<void> {
    if (this.workerProfile.concurrencyFor('runs') === null) return;

    await this.beat();

    this.timer = setInterval(
      // A missed beat is not fatal: dead needs four of them.
      () =>
        void this.beat().catch((error: unknown) =>
          this.logger.warn(`Worker heartbeat failed: ${String(error)}`),
        ),
      heartbeatSeconds(this.instanceConfig.config) * 1000,
    );

    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Upsert the row with the database clock, which the dead test also reads. */
  async beat(): Promise<void> {
    await this.db
      .insert(workerInstances)
      .values({ id: this.instanceId })
      .onConflictDoUpdate({
        target: workerInstances.id,
        set: { lastSeenAt: sql`now()` },
      });
  }
}
