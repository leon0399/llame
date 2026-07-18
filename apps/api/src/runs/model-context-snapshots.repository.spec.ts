import { type Db } from '../db/tenant-db.service';
import {
  ModelContextSnapshotConflictError,
  ModelContextSnapshotsRepository,
} from './model-context-snapshots.repository';
import { type EffectiveContextSnapshotInput } from './effective-context-resolver';

const ownerUserId = 'owner-a';
const payload: EffectiveContextSnapshotInput = {
  contentHash: 'content-hash',
  promptHash: 'prompt-hash',
  toolHash: 'tool-hash',
  source: 'model_override',
  systemPrompt: 'Prompt text',
  toolDeclarations: [
    {
      id: 'search',
      description: 'Search conversations',
      inputSchema: { type: 'object' },
    },
  ],
};

const snapshot = {
  id: 'snapshot-id',
  ownerUserId,
  ...payload,
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
};

function makeDb(options?: { inserted?: unknown[]; selected?: unknown[] }) {
  const returning = jest.fn().mockResolvedValue(options?.inserted ?? []);
  const onConflictDoNothing = jest.fn((_options: unknown) => ({ returning }));
  const values = jest.fn((_value: unknown) => ({ onConflictDoNothing }));
  const insert = jest.fn(() => ({ values }));

  const limit = jest.fn().mockResolvedValue(options?.selected ?? []);
  const where = jest.fn(() => ({ limit }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ where, innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    db: { insert, select } as unknown as Db,
    values,
    onConflictDoNothing,
    innerJoin,
    where,
  };
}

describe('ModelContextSnapshotsRepository', () => {
  it('creates an owner-local immutable snapshot without paths or execution context', async () => {
    const { db, values, onConflictDoNothing } = makeDb({
      inserted: [snapshot],
    });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse(
        ownerUserId,
        payload,
      ),
    ).resolves.toEqual(snapshot);
    expect(values).toHaveBeenCalledWith({ ownerUserId, ...payload });
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(inserted).sort()).toEqual([
      'contentHash',
      'ownerUserId',
      'promptHash',
      'source',
      'systemPrompt',
      'toolDeclarations',
      'toolHash',
    ]);
    const conflict = onConflictDoNothing.mock.calls[0][0] as {
      target: unknown;
    };
    expect(Array.isArray(conflict.target)).toBe(true);
  });

  it('reuses identical content only after an owner/source-scoped conflict lookup', async () => {
    const { db, where } = makeDb({ selected: [snapshot] });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse(
        ownerUserId,
        payload,
      ),
    ).resolves.toEqual(snapshot);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('rejects a hash reuse whose stored prompt or tool content conflicts', async () => {
    const { db } = makeDb({
      selected: [{ ...snapshot, systemPrompt: 'Different prompt' }],
    });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse(
        ownerUserId,
        payload,
      ),
    ).rejects.toBeInstanceOf(ModelContextSnapshotConflictError);
  });

  it('retrieves a snapshot only through a run owned by the same user', async () => {
    const { db, innerJoin, where } = makeDb({
      selected: [{ snapshot }],
    });

    await expect(
      new ModelContextSnapshotsRepository(db).findByOwnedRun(
        'run-id',
        ownerUserId,
      ),
    ).resolves.toEqual(snapshot);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
