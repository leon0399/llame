import { type PgColumn } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ModelContextSnapshot } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type EffectiveContextSnapshotInput } from './effective-context-resolver';
import {
  ModelContextSnapshotConflictError,
  ModelContextSnapshotsRepository,
} from './model-context-snapshots.repository';

type QueryCall = { method: string; args: Array<unknown> };
type LoggedQuery = { sql: string; params: Array<unknown> };

const now = new Date('2026-09-03T00:00:00.000Z');

const input: EffectiveContextSnapshotInput = {
  contentHash: 'content-a',
  availabilityHash: 'avail-a',
  promptHash: 'prompt-a',
  toolHash: 'tool-a',
  source: 'model_override',
  systemPrompt: 'Bound prompt',
  toolAvailabilityManifest: { version: 1, entries: [] },
  toolDeclarations: [
    { id: 'search_conversations', description: 'd', inputSchema: {} },
  ],
};

const snapshot: ModelContextSnapshot = {
  id: 'snapshot-1',
  ownerUserId: 'owner-1',
  createdAt: now,
  ...input,
};

type QueryRows =
  | ReadonlyArray<ModelContextSnapshot>
  | ReadonlyArray<{ snapshot: ModelContextSnapshot }>;

/** The builder arguments the repository hands this double, recorded verbatim. */
type SnapshotInsert = typeof schema.modelContextSnapshots.$inferInsert;
type ConflictTarget = { target: ReadonlyArray<PgColumn> };

function queryResult(value: QueryRows, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain = () =>
    Object.assign(terminal, {
      from: chain,
      innerJoin: chain,
      where: chain,
      orderBy: chain,
      limit: chain,
      returning: () => {
        calls.push({ method: 'returning', args: [] });
        return terminal;
      },
    });
  const onConflictDoNothing = (target: ConflictTarget) => {
    calls.push({ method: 'onConflictDoNothing', args: [target] });
    return chain();
  };
  const values = (valueToInsert: SnapshotInsert) => {
    calls.push({ method: 'values', args: [valueToInsert] });
    return Object.assign(terminal, { onConflictDoNothing, returning: chain });
  };
  return Object.assign(terminal, {
    from: chain,
    innerJoin: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    values,
    onConflictDoNothing,
    returning: () => {
      calls.push({ method: 'returning', args: [] });
      return terminal;
    },
  });
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: this double implements only the fluent methods this repository uses.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

function makeDb(options: {
  select?: Array<QueryRows>;
  insert?: Array<QueryRows>;
}) {
  const db: Db = drizzle.mock({ schema });
  const calls: Array<QueryCall> = [];
  const selectResults = [...(options.select ?? [])];
  const insertResults = [...(options.insert ?? [])];
  const select = vi
    .spyOn(db, 'select')
    .mockImplementation(() =>
      asQuery(queryResult(selectResults.shift() ?? [], calls)),
    );
  const insert = vi
    .spyOn(db, 'insert')
    .mockImplementation(() =>
      asQuery(queryResult(insertResults.shift() ?? [], calls)),
    );
  return { db, calls, select, insert };
}

function makeLoggedDb() {
  const queries: Array<LoggedQuery> = [];
  const db: Db = drizzle.mock({
    schema,
    logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
  });
  return { db, queries };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModelContextSnapshotConflictError', () => {
  it('exposes a stable name and message', () => {
    const error = new ModelContextSnapshotConflictError();
    expect(error.name).toBe('ModelContextSnapshotConflictError');
    expect(error.message).toBe(
      'Model context snapshot hash conflicts with stored content',
    );
  });
});

describe('ModelContextSnapshotsRepository.createOrReuse', () => {
  it('returns the inserted row and targets the owner/content/availability/source unique index', async () => {
    const { db, calls } = makeDb({ insert: [[snapshot]] });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse('owner-1', input),
    ).resolves.toBe(snapshot);

    expect(calls.find(({ method }) => method === 'values')?.args[0]).toEqual({
      ownerUserId: 'owner-1',
      ...input,
    });
    const conflict = calls.find(
      ({ method }) => method === 'onConflictDoNothing',
    );
    expect(conflict?.args[0]).toEqual({
      target: [
        schema.modelContextSnapshots.ownerUserId,
        schema.modelContextSnapshots.contentHash,
        schema.modelContextSnapshots.availabilityHash,
        schema.modelContextSnapshots.source,
      ],
    });
  });

  it('reuses an existing snapshot when every hashed field matches', async () => {
    const { db, select } = makeDb({ insert: [[]], select: [[snapshot]] });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse('owner-1', input),
    ).resolves.toBe(snapshot);
    expect(select).toHaveBeenCalledOnce();
  });

  const conflictingFields: Array<[string, Partial<ModelContextSnapshot>]> = [
    ['contentHash', { contentHash: 'other' }],
    ['availabilityHash', { availabilityHash: 'other' }],
    ['promptHash', { promptHash: 'other' }],
    ['toolHash', { toolHash: 'other' }],
    ['source', { source: 'project_default' }],
    ['systemPrompt', { systemPrompt: 'Other prompt' }],
    [
      'toolAvailabilityManifest',
      {
        toolAvailabilityManifest: {
          version: 1,
          entries: [{ id: 'x', state: 'unavailable', reason: 'tool_missing' }],
        },
      },
    ],
    ['toolDeclarations', { toolDeclarations: [] }],
  ];

  it.each(conflictingFields)(
    'conflicts when the stored %s differs from the insert input',
    async (_field, patch) => {
      const existing = { ...snapshot, ...patch };
      const { db } = makeDb({ insert: [[]], select: [[existing]] });

      await expect(
        new ModelContextSnapshotsRepository(db).createOrReuse('owner-1', input),
      ).rejects.toBeInstanceOf(ModelContextSnapshotConflictError);
    },
  );

  it('conflicts when the unique key hits but no row is visible', async () => {
    const { db } = makeDb({ insert: [[]], select: [[]] });

    await expect(
      new ModelContextSnapshotsRepository(db).createOrReuse('owner-1', input),
    ).rejects.toBeInstanceOf(ModelContextSnapshotConflictError);
  });

  it('inserts with on conflict do nothing on the owner/hash/source unique key', async () => {
    const { db, queries } = makeLoggedDb();
    await new ModelContextSnapshotsRepository(db)
      .createOrReuse('owner-bound', input)
      .catch(() => undefined);

    const insert = queries.find(({ sql }) => sql.startsWith('insert into'));
    expect(insert?.sql).toContain('insert into "model_context_snapshots"');
    expect(insert?.sql).toContain('on conflict');
    expect(insert?.sql).toContain('do nothing');
    expect(insert?.params).toEqual(
      expect.arrayContaining([
        'owner-bound',
        input.contentHash,
        input.availabilityHash,
        input.source,
      ]),
    );
  });
});

describe('ModelContextSnapshotsRepository.findByOwnedRun', () => {
  it('returns the joined snapshot for an owned run', async () => {
    const { db } = makeDb({ select: [[{ snapshot }]] });

    await expect(
      new ModelContextSnapshotsRepository(db).findByOwnedRun(
        'run-1',
        'owner-1',
      ),
    ).resolves.toBe(snapshot);
  });

  it('returns undefined when the join yields no row', async () => {
    const { db } = makeDb({ select: [[]] });

    await expect(
      new ModelContextSnapshotsRepository(db).findByOwnedRun(
        'run-1',
        'owner-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('joins runs to snapshots and scopes both by the owner', async () => {
    const { db, queries } = makeLoggedDb();
    await new ModelContextSnapshotsRepository(db)
      .findByOwnedRun('run-bound', 'owner-bound')
      .catch(() => undefined);

    expect(queries[0]?.sql).toContain('inner join "runs"');
    expect(queries[0]?.sql).toContain('"runs"."id" = $');
    expect(queries[0]?.sql).toContain('"runs"."user_id" = $');
    expect(queries[0]?.sql).toContain(
      '"model_context_snapshots"."owner_user_id" = $',
    );
    expect(queries[0]?.params).toEqual([
      'run-bound',
      'owner-bound',
      'owner-bound',
      1,
    ]);
  });
});
