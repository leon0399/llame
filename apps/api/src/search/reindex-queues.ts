import { defineQueue, expectRecord, expectString } from '../queue/queue';

/**
 * Search-domain queue contracts (#195). The reindex queue rebuilds ONE chat's
 * lexical projection; the sweep queue is the cron trigger that discovers stale
 * chats cross-tenant and fans out reindex jobs (backfill + version-bump rebuild +
 * a last-resort backstop for a lost enqueue — design D6). The sweep is a discovery
 * PRODUCER: it enqueues, the reindex workers process. The embed queue (chat-search-
 * embeddings design D5/D14) embeds ONE chat's outstanding documents; it rides its
 * OWN queue rather than the reindex job (different retry policy, different
 * concurrency profile — network-bound vs DB-bound), enqueued from every path that
 * changes the projection PLUS the sweep for chats the embedding-backlog predicate
 * reports as lagging. Everything queue-facing for search lives here.
 */

/** Rebuild the projection for one chat. */
export type SearchReindexJob = {
  chatId: string;
  ownerUserId: string;
};

/** Cron-triggered staleness sweep. The payload is an empty marker — the work is
 *  discovery, identical regardless of what triggered the tick. */
export type SearchSweepJob = Record<string, never>;

export const SEARCH_REINDEX_QUEUE = defineQueue<SearchReindexJob>({
  name: 'search-reindex',
  // Policy `stately` + per-job `singletonKey = chatId` (set at enqueue) → at most
  // one queued + one running rebuild per chat, so a burst of writes to one chat
  // collapses into a single pending rebuild (design D5). Content-hash idempotency
  // keeps a redundant rebuild harmless (wasted work, never wrong data).
  options: { policy: 'stately' },
  parse: (data) => {
    const record = expectRecord(data, 'search-reindex');
    return {
      chatId: expectString(record, 'chatId', 'search-reindex'),
      ownerUserId: expectString(record, 'ownerUserId', 'search-reindex'),
    };
  },
});

export const SEARCH_SWEEP_QUEUE = defineQueue<SearchSweepJob>({
  name: 'search-sweep',
  // `stately` so overlapping cron ticks (a slow sweep spanning the next tick)
  // don't stack — one queued + one running is enough.
  options: { policy: 'stately' },
  parse: () => ({}),
});

/** Sweep cadence: backfill + version-rebuild + last-resort backstop, not freshness
 *  (Tier-1 inline finalize carries freshness) — so a relaxed 5-minute cron (design D6). */
export const SEARCH_SWEEP_CRON = '*/5 * * * *';

/** Max chats a single sweep tick enqueues (bounds a cold-start backfill burst;
 *  the next tick continues). */
export const SEARCH_SWEEP_BATCH = 500;

/** Embed ONE chat's outstanding documents (chat-search-embeddings design D5). */
export type SearchEmbedJob = {
  chatId: string;
  ownerUserId: string;
};

export const SEARCH_EMBED_QUEUE = defineQueue<SearchEmbedJob>({
  name: 'search-embed',
  // Policy `stately` + per-job `singletonKey = chatId` (set at enqueue) — same
  // coalescing shape as SEARCH_REINDEX_QUEUE, so a burst of writes to one chat,
  // or a job re-enqueuing itself when bounded work remains (D5's "page rather
  // than load"), collapses into a single pending + a single running embed job.
  // retryLimit 5 + exponential backoff absorbs roughly half an hour of provider
  // outage before dead-lettering (design D5) — a stricter policy than the
  // reindex queue's engine default on purpose: a rebuild is local and should
  // fail loudly on a bug, while embedding rides a network call that legitimately
  // needs bounded retries. deadLetter stays at its default (true).
  options: { policy: 'stately', retryLimit: 5, retryBackoff: true },
  parse: (data) => {
    const record = expectRecord(data, 'search-embed');
    return {
      chatId: expectString(record, 'chatId', 'search-embed'),
      ownerUserId: expectString(record, 'ownerUserId', 'search-embed'),
    };
  },
});
