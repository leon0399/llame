import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { defineQueue, QUEUE, type Queue } from '../queue/queue';
import { SESSION_IDLE_TTL_MS } from './constants';
import { SessionsRepository } from './sessions.repository';

/** Cron tick payload — the job carries no data; the sweep derives everything. */
export const SESSIONS_CLEANUP_QUEUE = defineQueue<Record<string, never>>({
  name: 'sessions.cleanup',
});

/**
 * Expired-session housekeeping (#68) on a pg-boss cron (SPEC §24.0.1 — no
 * pg_cron extension; scheduling is application-level so it works on any
 * Postgres). The schedule upsert is idempotent across boots, and the delete is
 * idempotent across concurrent instances — safe however many processes run.
 *
 * The read path never serves stale rows anyway (validation and listing filter
 * expiry); this keeps the table itself from accumulating dead rows forever.
 */
@Injectable()
export class SessionCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly sessionsRepository: SessionsRepository,
    private readonly workerProfile: WorkerProfileService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Worker-profile gate (durable-run-workers D2/D3): a process whose active
    // profile doesn't include `sessions-cleanup` registers NOTHING for it.
    const concurrency = this.workerProfile.concurrencyFor('sessions-cleanup');
    if (concurrency === null) {
      return;
    }
    await this.queue.ensureQueue(SESSIONS_CLEANUP_QUEUE);
    // Hourly, off the :00 mark (self-hosted fleets thundering-herd less).
    await this.queue.schedule(SESSIONS_CLEANUP_QUEUE, '23 * * * *');
    await this.queue.consume(SESSIONS_CLEANUP_QUEUE, () => this.cleanup(), {
      concurrency,
    });
  }

  private async cleanup(): Promise<void> {
    try {
      const deleted =
        await this.sessionsRepository.deleteExpired(SESSION_IDLE_TTL_MS);
      if (deleted > 0) {
        this.logger.log(`Purged ${deleted} expired/idle session(s)`);
      }
    } catch (error) {
      // Log locally, then rethrow: pg-boss still marks the job failed and
      // applies retry policy — but the failure is visible in app logs too.
      this.logger.error(
        'Session cleanup sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
