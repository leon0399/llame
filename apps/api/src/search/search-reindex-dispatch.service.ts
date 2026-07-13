import { Inject, Injectable, Logger } from '@nestjs/common';

import { QUEUE, type Queue } from '../queue/queue';
import { SEARCH_REINDEX_QUEUE } from './reindex-queues';

/**
 * SearchReindexDispatchService (#195) — the enqueue seam the content-write paths
 * (user-message persist, assistant finalization, fork) call to keep search fresh.
 *
 * BEST-EFFORT by contract: a failed enqueue MUST NEVER fail the user-facing write
 * (mirrors RunDispatchService's non-transactional-enqueue stance). A lost enqueue
 * self-heals — the discovery sweep re-detects the stale chat from message
 * timestamps and re-enqueues (design D6). Coalescing (`singletonKey = chatId` under
 * the queue's `stately` policy) collapses a write burst into one pending rebuild.
 */
@Injectable()
export class SearchReindexDispatchService {
  private readonly logger = new Logger(SearchReindexDispatchService.name);
  private queueReady: Promise<void> | undefined;

  constructor(@Inject(QUEUE) private readonly queue: Queue) {}

  async enqueueChatReindex(chatId: string, ownerUserId: string): Promise<void> {
    try {
      await this.ensureQueue();
      await this.queue.enqueue(
        SEARCH_REINDEX_QUEUE,
        { chatId, ownerUserId },
        { singletonKey: chatId },
      );
    } catch (error) {
      // Swallow: freshness is best-effort, the sweep is the guarantee.
      this.logger.warn(
        `Reindex enqueue failed for chat ${chatId}; the discovery sweep will re-enqueue it as a backstop`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private ensureQueue(): Promise<void> {
    this.queueReady ??= this.queue
      .ensureQueue(SEARCH_REINDEX_QUEUE)
      .catch((error: unknown) => {
        this.queueReady = undefined;
        throw error;
      });
    return this.queueReady;
  }
}
