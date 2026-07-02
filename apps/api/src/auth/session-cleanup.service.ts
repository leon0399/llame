import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { QUEUE, type Queue } from '../queue/queue';
import { SESSION_IDLE_TTL_MS } from './constants';
import { SessionsRepository } from './sessions.repository';

export const SESSIONS_CLEANUP_QUEUE = 'sessions.cleanup';

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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureQueue(SESSIONS_CLEANUP_QUEUE);
    // Hourly, off the :00 mark (self-hosted fleets thundering-herd less).
    await this.queue.schedule(SESSIONS_CLEANUP_QUEUE, '23 * * * *');
    await this.queue.consume(SESSIONS_CLEANUP_QUEUE, () => this.cleanup());
  }

  private async cleanup(): Promise<void> {
    const deleted =
      await this.sessionsRepository.deleteExpired(SESSION_IDLE_TTL_MS);
    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired/idle session(s)`);
    }
  }
}
