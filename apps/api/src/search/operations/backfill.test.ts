/**
 * runBackfill unit tests (chat-search-embeddings/operations, layer 7, task
 * 7.1) — fakes `tenantDb.runAsPublic` entirely (no real Postgres; mirrors
 * `embedding-binding-boot-check.service.test.ts`'s DB-free pattern), so this
 * proves the enumerate→enqueue control flow and its idempotency contract
 * without a database. SQL predicate correctness against the real
 * `llame_search_embedding_coverage` function is covered by
 * `operations.integration.test.ts`.
 */
import {
  BACKFILL_MAX_ROWS,
  runBackfill,
  type CoverageQueryRunner,
} from './backfill';

type Row = { chat_id: string; owner_user_id: string };

function fakeTenantDb(rows: Row[]): CoverageQueryRunner {
  return { runAsPublic: (fn) => fn({ execute: () => Promise.resolve(rows) }) };
}

describe('runBackfill', () => {
  it('enqueues one job per row the coverage query returns', async () => {
    const rows: Row[] = [
      { chat_id: 'c1', owner_user_id: 'u1' },
      { chat_id: 'c2', owner_user_id: 'u2' },
    ];
    const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
    const { enqueued } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbed },
      'model-a',
      1,
    );

    expect(enqueued).toBe(2);
    expect(enqueueChatEmbed).toHaveBeenCalledTimes(2);
    expect(enqueueChatEmbed).toHaveBeenCalledWith('c1', 'u1');
    expect(enqueueChatEmbed).toHaveBeenCalledWith('c2', 'u2');
  });

  it('enqueues nothing and reports zero when the coverage query returns no rows', async () => {
    const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
    const { enqueued } = await runBackfill(
      fakeTenantDb([]),
      { enqueueChatEmbed },
      'model-a',
      1,
    );

    expect(enqueued).toBe(0);
    expect(enqueueChatEmbed).not.toHaveBeenCalled();
  });

  it('enqueues every row across a batch larger than the internal concurrency window', async () => {
    const rows: Row[] = Array.from({ length: 45 }, (_, i) => ({
      chat_id: `c${i}`,
      owner_user_id: `u${i}`,
    }));
    const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
    const { enqueued } = await runBackfill(
      fakeTenantDb(rows),
      { enqueueChatEmbed },
      'model-a',
      1,
    );

    expect(enqueued).toBe(45);
    expect(enqueueChatEmbed).toHaveBeenCalledTimes(45);
    for (const row of rows) {
      expect(enqueueChatEmbed).toHaveBeenCalledWith(
        row.chat_id,
        row.owner_user_id,
      );
    }
  });

  it('BACKFILL_MAX_ROWS is large enough to be a one-shot limit, not a realistic cap', () => {
    expect(BACKFILL_MAX_ROWS).toBeGreaterThan(10_000);
  });
});
