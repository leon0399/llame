import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { QUEUE, type Queue } from '../queue/queue';
import { SEARCH_EMBED_QUEUE } from './reindex-queues';

export type ChatEmbedDispatcher = Pick<
  SearchEmbedDispatchService,
  'enqueueChatEmbed'
>;

/** The strict-reporting capability `backfill` needs (chat-search-embeddings/
 *  operations, layer 7) — see `enqueueChatEmbedStrict`'s own doc comment for
 *  why it is a separate method rather than a mode flag on the one above. */
export type StrictChatEmbedDispatcher = Pick<
  SearchEmbedDispatchService,
  'enqueueChatEmbedStrict'
>;

/**
 * SearchEmbedDispatchService (chat-search-embeddings, design D5) — the
 * enqueue seam every projection-changing path calls to keep embeddings
 * fresh: the inline Tier-1 finalize rebuild, the reindex worker (after its
 * own rebuild lands), fork, and the sweep for chats the embedding-backlog
 * predicate reports as lagging. Mirrors SearchReindexDispatchService's
 * contract exactly:
 *
 * - BEST-EFFORT: a failed enqueue MUST NEVER fail the user-facing write or
 *   the caller's own rebuild — a lost enqueue self-heals via the sweep.
 * - Coalescing (`singletonKey = chatId` under the queue's `stately` policy)
 *   collapses a write burst — or a job re-enqueuing itself for bounded
 *   remaining work — into one pending embed job per chat.
 * - OFF-BY-DEFAULT (spec "the embedding layer is off by default"): with no
 *   `search.chats.embeddingModelId` configured, this is a no-op that never
 *   touches the queue — no `ensureQueue`, no send. An instance that never
 *   declares an embedding model therefore never creates `search-embed`.
 */
@Injectable()
export class SearchEmbedDispatchService {
  private readonly logger = new Logger(SearchEmbedDispatchService.name);
  private queueReady: Promise<void> | undefined;

  constructor(
    @Inject(QUEUE)
    private readonly queue: Queue,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async enqueueChatEmbed(chatId: string, ownerUserId: string): Promise<void> {
    if (!this.instanceConfig.config.search.chats.embeddingModelId) {
      return;
    }
    try {
      await this.ensureQueue();
      await this.queue.enqueue(
        SEARCH_EMBED_QUEUE,
        { chatId, ownerUserId },
        { singletonKey: chatId },
      );
    } catch (error) {
      // Swallow: freshness is best-effort, the sweep is the guarantee.
      this.logger.warn(
        `Embed enqueue failed for chat ${chatId}; the discovery sweep will re-enqueue it as a backstop`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Strict variant for the `search:backfill` operator command (chat-search-
   * embeddings/operations, layer 7) — deliberately NOT a mode flag on
   * `enqueueChatEmbed` above, because the two callers have opposite
   * correctness requirements. Every write-hook caller of `enqueueChatEmbed`
   * needs best-effort: a failed enqueue must never fail the user's write,
   * and a lost one self-heals via the sweep. `backfill` has no sweep to
   * fall back on and no user-facing write to protect — its entire output IS
   * "how many jobs actually got queued," so swallowing a failure there would
   * make it print a count of chats it never actually enqueued. Failures
   * here propagate to the caller, which must count only what this resolves
   * without throwing.
   */
  async enqueueChatEmbedStrict(
    chatId: string,
    ownerUserId: string,
  ): Promise<void> {
    await this.ensureQueue();
    await this.queue.enqueue(
      SEARCH_EMBED_QUEUE,
      { chatId, ownerUserId },
      { singletonKey: chatId },
    );
  }

  private ensureQueue(): Promise<void> {
    this.queueReady ??= this.queue
      .ensureQueue(SEARCH_EMBED_QUEUE)
      .catch((error: unknown) => {
        this.queueReady = undefined;
        throw error;
      });
    return this.queueReady;
  }
}
