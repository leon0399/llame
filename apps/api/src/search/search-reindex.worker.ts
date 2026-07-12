import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { TenantDbService } from '../db/tenant-db.service';
import { QUEUE, type Queue } from '../queue/queue';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import {
  SEARCH_REINDEX_QUEUE,
  SEARCH_SWEEP_BATCH,
  SEARCH_SWEEP_CRON,
  SEARCH_SWEEP_QUEUE,
} from './reindex-queues';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchIndexService } from './search-index.service';

/**
 * SearchReindexWorker (#195) — consumes the reindex queue (one chat per job) and
 * runs the 5-minute discovery sweep. Co-located in the API process for phase 1,
 * like RunsWorkerService; the dedicated worker entrypoint is #116.
 *
 * The sweep is REPAIR + BACKFILL + version-migration, not freshness (the write
 * hooks carry freshness). It enumerates stale chats across all tenants via the
 * `llame_search_stale_chats` SECURITY DEFINER function (BYPASSRLS — the only way
 * to see all tenants under FORCE RLS), which returns ONLY identifiers; the actual
 * reindex of each chat then runs strictly inside that owner's `runAs` scope.
 */
@Injectable()
export class SearchReindexWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchReindexWorker.name);

  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly tenantDb: TenantDbService,
    private readonly indexService: SearchIndexService,
    private readonly dispatch: SearchReindexDispatchService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureQueue(SEARCH_REINDEX_QUEUE);
    await this.queue.ensureQueue(SEARCH_SWEEP_QUEUE);
    await this.queue.consume(
      SEARCH_REINDEX_QUEUE,
      (job) => this.indexService.reindexChat(job.chatId, job.ownerUserId),
      { pollingIntervalSeconds: 1 },
    );
    await this.queue.consume(SEARCH_SWEEP_QUEUE, () => this.runSweep(), {
      pollingIntervalSeconds: 5,
    });
    await this.queue.schedule(SEARCH_SWEEP_QUEUE, SEARCH_SWEEP_CRON, {
      reason: 'cron',
    });
    // Backfill promptly on deploy instead of waiting for the first cron tick.
    await this.queue.enqueue(SEARCH_SWEEP_QUEUE, { reason: 'boot' });
    this.logger.log(
      `Consuming '${SEARCH_REINDEX_QUEUE.name}' + '${SEARCH_SWEEP_QUEUE.name}' (sweep '${SEARCH_SWEEP_CRON}')`,
    );
  }

  private async runSweep(): Promise<void> {
    // runAsPublic sets the empty identity, but the discovery function is SECURITY
    // DEFINER (runs AS app_rls, BYPASSRLS) and does not filter by caller, so it
    // returns every stale chat regardless. Only identifiers cross this boundary.
    const stale = await this.tenantDb.runAsPublic((tx) =>
      tx.execute<{ chat_id: string; owner_user_id: string }>(sql`
        SELECT chat_id, owner_user_id
        FROM llame_search_stale_chats(${CHUNKER_VERSION}, ${SEARCH_SWEEP_BATCH})
      `),
    );
    const rows = [...stale];
    for (const row of rows) {
      await this.dispatch.enqueueChatReindex(row.chat_id, row.owner_user_id);
    }
    if (rows.length > 0) {
      this.logger.log(`Sweep enqueued ${rows.length} chat reindex job(s)`);
    }
  }
}
