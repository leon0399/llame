/**
 * runBackfill unit tests (chat-search-embeddings/operations, layer 7, task
 * 7.1) — fakes `tenantDb.runAsPublic` entirely (no real Postgres; mirrors
 * `embedding-binding-boot-check.service.test.ts`'s DB-free pattern), so this
 * proves the enumerate→enqueue control flow and its idempotency contract
 * without a database. SQL predicate correctness against the real
 * `llame_search_embedding_coverage` function is covered by
 * `operations.integration.test.ts`.
 *
 * The failure-reporting tests below (review finding) prove `runBackfill`
 * against `enqueueChatEmbedStrict` — the STRICT dispatcher method that
 * propagates a failed enqueue rather than swallowing it (unlike
 * `enqueueChatEmbed`, which every write-hook caller uses and which is
 * correctly best-effort for THAT contract). Confirmed to fail first: with
 * `runBackfill` counting `list.length` instead of settled successes (the
 * pre-fix shape), "one enqueue rejects" reported `enqueued: 2` for 2 rows
 * with one rejection — the exact "prints a reassuring number for work that
 * didn't happen" bug this file now guards against.
 */
import {
  BACKFILL_MAX_ROWS,
  runBackfill,
  type CoverageQueryRunner,
} from './backfill';

type Row = { chat_id: string; owner_user_id: string };

function fakeTenantDb(rows: Array<Row>): CoverageQueryRunner {
  return { runAsPublic: (fn) => fn({ execute: () => Promise.resolve(rows) }) };
}

describe('runBackfill', () => {
  // Regression (review, PR #536): pg-boss returns null when a chat already had
  // a job queued under its singleton key. Counting that as newly enqueued made
  // a re-run of an already-queued corpus claim it queued everything again,
  // contradicting this module's "reports only what actually enqueued" promise.
  it('reports a coalesced enqueue separately from a new one', async () => {
    const rows: Array<Row> = [
      { chat_id: 'fresh', owner_user_id: 'u1' },
      { chat_id: 'already', owner_user_id: 'u2' },
    ];
    const enqueueChatEmbedStrict = vi.fn((chatId: string) =>
      Promise.resolve(chatId === 'already' ? null : `job-${chatId}`),
    );

    const { enqueued, coalesced, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(1);
    expect(coalesced).toBe(1);
    expect(failures).toEqual([]);
  });

  it('enqueues one job per row the coverage query returns', async () => {
    const rows: Array<Row> = [
      { chat_id: 'c1', owner_user_id: 'u1' },
      { chat_id: 'c2', owner_user_id: 'u2' },
    ];
    const enqueueChatEmbedStrict = vi.fn().mockResolvedValue(undefined);
    const { enqueued, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(2);
    expect(failures).toEqual([]);
    expect(enqueueChatEmbedStrict).toHaveBeenCalledTimes(2);
    expect(enqueueChatEmbedStrict).toHaveBeenCalledWith('c1', 'u1');
    expect(enqueueChatEmbedStrict).toHaveBeenCalledWith('c2', 'u2');
  });

  it('enqueues nothing and reports zero when the coverage query returns no rows', async () => {
    const enqueueChatEmbedStrict = vi.fn().mockResolvedValue(undefined);
    const { enqueued, failures } = await runBackfill(
      fakeTenantDb([]),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(0);
    expect(failures).toEqual([]);
    expect(enqueueChatEmbedStrict).not.toHaveBeenCalled();
  });

  it('enqueues every row across a batch larger than the internal concurrency window', async () => {
    const rows: Array<Row> = Array.from({ length: 45 }, (_, i) => ({
      chat_id: `c${i}`,
      owner_user_id: `u${i}`,
    }));
    const enqueueChatEmbedStrict = vi.fn().mockResolvedValue(undefined);
    const { enqueued, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(45);
    expect(failures).toEqual([]);
    expect(enqueueChatEmbedStrict).toHaveBeenCalledTimes(45);
    for (const row of rows) {
      expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(
        row.chat_id,
        row.owner_user_id,
      );
    }
  });

  it('counts only the enqueues that actually succeeded when one rejects — never the row count', async () => {
    const rows: Array<Row> = [
      { chat_id: 'c1', owner_user_id: 'u1' },
      { chat_id: 'c2', owner_user_id: 'u2' },
    ];
    const enqueueChatEmbedStrict = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue unreachable'));

    const { enqueued, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(1);
    expect(failures).toEqual([
      { chatId: 'c2', ownerUserId: 'u2', message: 'queue unreachable' },
    ]);
  });

  it('one rejection in a concurrency batch does not suppress the other outcomes in it', async () => {
    // All 3 rows land in the SAME 20-wide batch — proves Promise.allSettled
    // (not Promise.all, which would short-circuit and lose the other two
    // results entirely) is what's actually driving the batch.
    const rows: Array<Row> = [
      { chat_id: 'c1', owner_user_id: 'u1' },
      { chat_id: 'c2', owner_user_id: 'u2' },
      { chat_id: 'c3', owner_user_id: 'u3' },
    ];
    const enqueueChatEmbedStrict = vi.fn((chatId: string) =>
      chatId === 'c2'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(`job-${chatId}`),
    );

    const { enqueued, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(2);
    expect(failures).toEqual([
      { chatId: 'c2', ownerUserId: 'u2', message: 'boom' },
    ]);
    expect(enqueueChatEmbedStrict).toHaveBeenCalledTimes(3);
  });

  it('a non-Error rejection is still reported with a readable message', async () => {
    const rows: Array<Row> = [{ chat_id: 'c1', owner_user_id: 'u1' }];
    const enqueueChatEmbedStrict = vi.fn().mockRejectedValue('plain string');

    const { enqueued, failures } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbedStrict },
      'model-a',
      1,
    );

    expect(enqueued).toBe(0);
    expect(failures).toEqual([
      { chatId: 'c1', ownerUserId: 'u1', message: 'plain string' },
    ]);
  });

  it('BACKFILL_MAX_ROWS is large enough to be a one-shot limit, not a realistic cap', () => {
    expect(BACKFILL_MAX_ROWS).toBeGreaterThan(10_000);
  });
});
