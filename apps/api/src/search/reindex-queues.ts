import { defineQueue } from '../queue/queue';

/**
 * Search-domain queue contracts (#195). The reindex queue rebuilds ONE chat's
 * lexical projection; the sweep queue is the cron trigger that discovers stale
 * chats cross-tenant and fans out reindex jobs (backfill + version-bump rebuild +
 * lost-enqueue repair — design D6). Everything queue-facing for search lives here.
 */

/** Rebuild the projection for one chat. */
export type SearchReindexJob = {
  chatId: string;
  ownerUserId: string;
};

/** Cron-triggered staleness sweep (payload is a marker; the work is discovery). */
export type SearchSweepJob = {
  reason: 'cron' | 'boot';
};

function expectRecord(data: unknown, queue: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError(`Malformed '${queue}' job: payload is not an object`);
  }
  return data as Record<string, unknown>;
}

function expectString(
  value: Record<string, unknown>,
  field: string,
  queue: string,
): string {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(
      `Malformed '${queue}' job: expected non-empty string '${field}'`,
    );
  }
  return raw;
}

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
  parse: (data) => {
    const record = expectRecord(data, 'search-sweep');
    const reason = record.reason === 'boot' ? 'boot' : 'cron';
    return { reason };
  },
});

/** Sweep cadence: repair/backfill, not freshness (hooks carry freshness) — so a
 *  relaxed 5-minute cron (design D6). */
export const SEARCH_SWEEP_CRON = '*/5 * * * *';

/** Max chats a single sweep tick enqueues (bounds a cold-start backfill burst;
 *  the next tick continues). */
export const SEARCH_SWEEP_BATCH = 500;
