/**
 * runOwnerBatches unit tests (chat-search-embeddings/operations, layer 7,
 * efficiency-pass addendum) — pure batching logic, no Drizzle types, no
 * database: `runAsOwner` is already the fully-bound per-owner callback, so
 * these tests fake it directly. `forEachOwner`'s DB-touching wrapper (user
 * listing + `tenantDb.runAs` scoping) is covered by
 * `operations.integration.test.ts`, which needs a real Postgres.
 *
 * Confirmed to fail first: with the pre-fix serial `for...of` + no failure
 * tracking (this file's own prior shape), "one owner rejects" reported
 * `total`/`affectedOwners` for every owner including the rejected one, and
 * `failures` stayed empty — the same "reports success for work that didn't
 * happen" bug already fixed once in `backfill.ts`.
 */
import { runOwnerBatches } from './owner-write';

describe('runOwnerBatches', () => {
  it('sums counts and marks affected owners for a fully successful run', async () => {
    const runAsOwner = vi.fn((ownerId: string) =>
      Promise.resolve({ count: ownerId === 'u2' ? 0 : 3 }),
    );

    const { total, affectedOwners, failures } = await runOwnerBatches(
      ['u1', 'u2', 'u3'],
      runAsOwner,
    );

    expect(total).toBe(6);
    expect(affectedOwners).toBe(2); // u2 affected 0 rows, doesn't count
    expect(failures).toEqual([]);
    expect(runAsOwner).toHaveBeenCalledTimes(3);
  });

  it('returns zero/empty for an empty owner list without calling runAsOwner', async () => {
    const runAsOwner = vi.fn();
    const result = await runOwnerBatches([], runAsOwner);

    expect(result).toEqual({ total: 0, affectedOwners: 0, failures: [] });
    expect(runAsOwner).not.toHaveBeenCalled();
  });

  it('one rejection does not suppress the other outcomes in its 20-wide batch', async () => {
    const ownerIds = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const runAsOwner = vi.fn((ownerId: string) =>
      ownerId === 'u10'
        ? Promise.reject(new Error('connection reset'))
        : Promise.resolve({ count: 1 }),
    );

    const { total, affectedOwners, failures } = await runOwnerBatches(
      ownerIds,
      runAsOwner,
    );

    expect(total).toBe(19);
    expect(affectedOwners).toBe(19);
    expect(failures).toEqual([{ ownerId: 'u10', message: 'connection reset' }]);
    expect(runAsOwner).toHaveBeenCalledTimes(20);
  });

  it('processes owners across multiple batches (>20), not just the first window', async () => {
    const ownerIds = Array.from({ length: 45 }, (_, i) => `u${i}`);
    const runAsOwner = vi.fn().mockResolvedValue({ count: 1 });

    const { total, affectedOwners, failures } = await runOwnerBatches(
      ownerIds,
      runAsOwner,
    );

    expect(total).toBe(45);
    expect(affectedOwners).toBe(45);
    expect(failures).toEqual([]);
    expect(runAsOwner).toHaveBeenCalledTimes(45);
    for (const id of ownerIds) {
      expect(runAsOwner).toHaveBeenCalledWith(id);
    }
  });

  it('a non-Error rejection is still reported with a readable message', async () => {
    const runAsOwner = vi.fn().mockRejectedValue('plain string reason');

    const { failures } = await runOwnerBatches(['u1'], runAsOwner);

    expect(failures).toEqual([
      { ownerId: 'u1', message: 'plain string reason' },
    ]);
  });

  it('every owner failing is still reported per-owner, not collapsed', async () => {
    const ownerIds = ['u1', 'u2', 'u3'];
    const runAsOwner = vi.fn((ownerId: string) =>
      Promise.reject(new Error(`boom-${ownerId}`)),
    );

    const { total, affectedOwners, failures } = await runOwnerBatches(
      ownerIds,
      runAsOwner,
    );

    expect(total).toBe(0);
    expect(affectedOwners).toBe(0);
    expect(failures).toHaveLength(3);
    expect(failures.map((f) => f.ownerId).sort()).toEqual(['u1', 'u2', 'u3']);
  });
});
