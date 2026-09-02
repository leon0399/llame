/**
 * `backfill` (chat-search-embeddings/operations, layer 7, task 7.1) — the
 * operator-invoked producer that starts bulk embedding work: a freshly
 * declared corpus model, a corpus repointed at a different model, or an
 * `EMBED_INPUT_VERSION` bump (design D6 "bulk work is never automatic" — the
 * sweep's own embed-backlog branch deliberately never does this, see
 * `search-reindex.worker.ts`'s class doc comment).
 *
 * A PRODUCER, not a processor (design D14): it enumerates uncovered chats
 * through the EXISTING `llame_search_embedding_coverage` discovery function
 * and enqueues onto the `search-embed` queue via
 * `SearchEmbedDispatchService`; the already-shipped `SearchEmbedWorker`
 * drains it. It must never embed inline — that would duplicate the worker's
 * persist/guard logic (every D7/D16 trap lives there), bypass the operator's
 * `search-embed` concurrency dial, and need a provider credential in a
 * process that otherwise has none. Consuming coverage() as-is is deliberate
 * (see the operations CLI's module doc comment): `outstanding_count > 0` is
 * EXACTLY the worklist backfill needs, so there is no "third function" to
 * justify here — unlike the coverage readout, which needs a genuinely wider
 * predicate (see `coverage-report.ts`).
 *
 * Idempotent by construction, not by any bookkeeping this file adds: a
 * second run against an already-covered corpus asks coverage() the same
 * question and gets zero rows back, because `needs_embedding` (computed by
 * the embed worker's own persisted columns) is already false for every
 * document — so a repeat backfill enqueues nothing and writes no row of its
 * own (it writes nothing at all, ever; only the worker persists).
 *
 * REPORTS ONLY WHAT ACTUALLY ENQUEUED (review finding). Enqueues through
 * `SearchEmbedDispatchService.enqueueChatEmbedStrict` — NOT the ordinary
 * best-effort `enqueueChatEmbed` every write-hook caller uses — because a
 * swallowed enqueue failure here has no sweep to self-heal it and no
 * user-facing write to protect: if pg-boss were unreachable mid-backfill,
 * best-effort enqueue would let this print "enqueued 5000 chat(s)" while
 * zero jobs were actually queued. Each row's enqueue is tracked
 * independently (`Promise.allSettled`, not `Promise.all` — one rejection
 * must not abort the batch or hide the other 19 outcomes in it); `enqueued`
 * counts only settled successes, and every failure is returned so the
 * caller can report it and exit non-zero.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';

import type { StrictChatEmbedDispatcher } from '../search-embed-dispatch.service';

/**
 * `llame_search_embedding_coverage` takes a single `max_rows` LIMIT with no
 * offset/cursor — it is a one-shot top-N discovery function (see its own
 * migration header), not a paginable cursor. Calling it repeatedly with the
 * same limit would return the identical top rows forever, since `backfill`
 * itself never removes anything from `needs_embedding` (only the async embed
 * worker's persist does, out of band) — so a single call with a limit large
 * enough for any realistic self-hosted corpus is the correct shape, matching
 * how the function is designed to be consumed.
 */
export const BACKFILL_MAX_ROWS = 1_000_000;

/** One chat `llame_search_embedding_coverage` reports as needing work. */
type OutstandingRow = { chat_id: string; owner_user_id: string };

/**
 * The minimal capability `runBackfill` needs from `TenantDbService` —
 * narrowed to exactly the one query shape it issues (#268 "narrow the
 * dependency, not the fake"), rather than `Pick<TenantDbService,
 * 'runAsPublic'>` verbatim: that Pick's callback parameter is the full
 * Drizzle `Db` type, which a unit test cannot construct a structural fake
 * for without a cast. The real `TenantDbService` satisfies this narrower
 * shape automatically (its `Db` callback parameter has a superset of what
 * `execute` needs here).
 */
export type CoverageQueryRunner = {
  runAsPublic<T>(
    fn: (tx: {
      execute: (query: SQLWrapper) => Promise<Iterable<OutstandingRow>>;
    }) => Promise<T>,
  ): Promise<T>;
};

/** One chat whose `enqueueChatEmbedStrict` call rejected. */
export type EnqueueFailure = {
  chatId: string;
  ownerUserId: string;
  message: string;
};

/** Enqueue `rows` in bounded-parallel batches, tracking each outcome
 *  independently — same batching shape as `search-reindex.worker.ts`'s
 *  `enqueueRowsBounded` (a distinct producer, a distinct queue, kept as a
 *  small local twin rather than an import across that file's worker-specific
 *  concerns), but `Promise.allSettled` rather than `Promise.all`: this
 *  file's whole point is knowing which chats did and didn't enqueue, so one
 *  rejection must not short-circuit the batch and swallow the other 19
 *  outcomes in it. */
async function enqueueBounded(
  rows: ReadonlyArray<OutstandingRow>,
  enqueueOne: (chatId: string, ownerUserId: string) => Promise<string | null>,
): Promise<{
  succeeded: number;
  coalesced: number;
  failures: Array<EnqueueFailure>;
}> {
  const CONCURRENCY = 20;
  let succeeded = 0;
  // pg-boss returns null when the chat already had a job queued under its
  // singleton key. That is not a failure — the work is scheduled either way —
  // but counting it as newly enqueued contradicts this file's own promise to
  // report only what actually enqueued, and would make a re-run of an
  // already-queued corpus claim it queued everything a second time.
  let coalesced = 0;
  const failures: Array<EnqueueFailure> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((row) => enqueueOne(row.chat_id, row.owner_user_id)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value === null) {
          coalesced += 1;
        } else {
          succeeded += 1;
        }
      } else {
        const row = batch[index];
        failures.push({
          chatId: row.chat_id,
          ownerUserId: row.owner_user_id,
          message:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });
  }
  return { succeeded, coalesced, failures };
}

export type BackfillResult = {
  /** Chats that actually enqueued — never a count of attempts. */
  enqueued: number;
  /** Chats already queued under their singleton key, so not enqueued again.
   *  Not a failure: the work is scheduled either way. */
  coalesced: number;
  /** Chats whose enqueue failed; empty on a fully successful run. The
   *  caller must treat any non-empty result as a failed command. */
  failures: Array<EnqueueFailure>;
};

/**
 * Enumerate every chat with outstanding embedding work for
 * `(modelId, inputVersion)` and enqueue one `search-embed` job per chat.
 * Issues no provider request itself — see this file's header.
 */
export async function runBackfill(
  tenantDb: CoverageQueryRunner,
  dispatch: StrictChatEmbedDispatcher,
  modelId: string,
  inputVersion: number,
): Promise<BackfillResult> {
  const rows = await tenantDb.runAsPublic((tx) =>
    tx.execute(sql`
      SELECT chat_id, owner_user_id
      FROM llame_search_embedding_coverage(${modelId}, ${inputVersion}, ${BACKFILL_MAX_ROWS})
    `),
  );
  const list = [...rows];
  const { succeeded, coalesced, failures } = await enqueueBounded(
    list,
    (chatId, ownerUserId) =>
      dispatch.enqueueChatEmbedStrict(chatId, ownerUserId),
  );
  return { enqueued: succeeded, coalesced, failures };
}
