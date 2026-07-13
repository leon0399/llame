import { defineQueue, expectRecord, expectString } from '../queue/queue';

/**
 * Search-domain queue contracts (#195). The reindex queue rebuilds ONE chat's
 * lexical projection; the sweep queue is the cron trigger that discovers stale
 * chats cross-tenant and fans out reindex jobs (backfill + version-bump rebuild +
 * a last-resort backstop for a lost enqueue — design D6). The sweep is a discovery
 * PRODUCER: it enqueues, the reindex workers process. Everything queue-facing for
 * search lives here.
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
