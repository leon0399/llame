import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  PinReorderMismatchError,
  PinsRepository,
  planPinReorder,
} from './pins-repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

const chatPin = {
  userId: 'owner',
  itemType: 'chat' as const,
  itemId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  pinnedAt: new Date('2026-08-01T00:00:00.000Z'),
  position: 0,
};
const projectPin = {
  userId: 'owner',
  itemType: 'project' as const,
  itemId: '1b6f5499-dde4-43cf-89fe-037998a0fe64',
  pinnedAt: new Date('2026-08-02T00:00:00.000Z'),
  position: 1,
};

function makeLoggedDb() {
  const queries: Array<LoggedQuery> = [];
  const db: Db = drizzle.mock({
    schema,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });

  return { db, queries };
}

function writeResult<T>(result: T, setValues?: Array<{ position: number }>) {
  const terminal = Promise.resolve(result);
  const where = vi.fn(() => terminal);
  const set = vi.fn((value: { position: number }) => {
    setValues?.push(value);
    return { where };
  });
  return { set, where };
}

function selectResult<T>(result: T): never {
  const whereResult = Promise.resolve(result);
  const query = Object.assign(whereResult, {
    from: vi.fn(() => ({ where: vi.fn(() => whereResult) })),
    orderBy: vi.fn(() => whereResult),
    limit: vi.fn(() => whereResult),
  });
  // SAFETY: this Promise double implements the exact select().from().where()
  // chain used by the repository.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function asDbQuery<T extends object>(query: T): never {
  // SAFETY: each test double implements the exact fluent methods used by the
  // repository and ends in a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function nextSelect(results: Array<never>): never {
  const result = results.shift();
  if (result === undefined) throw new Error('unexpected select call');
  return result;
}

describe('PinsRepository ordering', () => {
  it('lists pins by position, then item id', async () => {
    const { db, queries } = makeLoggedDb();
    await new PinsRepository(db).listWithCards('owner').catch(() => null);

    expect(queries[0]?.sql).toContain(
      'order by "pins"."position" asc, "pins"."item_id"',
    );
  });

  it('computes a net-new pin head position in the insert and leaves conflicts untouched', async () => {
    const { db, queries } = makeLoggedDb();
    await new PinsRepository(db)
      .pin('owner', 'chat', 'chat-new')
      .catch(() => null);

    const insert = queries.find(({ sql }) => sql.startsWith('insert into'));
    expect(insert?.sql).toContain('coalesce');
    expect(insert?.sql).toContain('min("pins"."position")');
    expect(insert?.sql).toContain(
      'on conflict ("user_id","item_type","item_id") do nothing',
    );
    expect(queries.some(({ sql }) => sql.startsWith('update "pins"'))).toBe(
      false,
    );
  });
});

describe('PinsRepository reorder', () => {
  const existing = [
    { itemType: 'chat' as const, itemId: 'chat-a', position: 0 },
    { itemType: 'project' as const, itemId: 'project-b', position: -1 },
  ];

  it('plans a complete mixed pin set in the submitted order', () => {
    const assignments = planPinReorder(existing, [
      { itemType: 'project', itemId: 'project-b' },
      { itemType: 'chat', itemId: 'chat-a' },
    ]);

    expect(assignments.map(({ position }) => position)).toEqual([-3, -4, 0, 1]);
    expect(assignments.slice(-2).map(({ itemId }) => itemId)).toEqual([
      'project-b',
      'chat-a',
    ]);
  });

  it('rejects an incomplete set before planning any update', () => {
    expect(() =>
      planPinReorder(existing, [{ itemType: 'chat', itemId: 'chat-a' }]),
    ).toThrow(PinReorderMismatchError);
  });

  it('rejects duplicate or foreign items before planning any update', () => {
    expect(() =>
      planPinReorder(existing, [
        { itemType: 'chat', itemId: 'chat-a' },
        { itemType: 'chat', itemId: 'chat-a' },
      ]),
    ).toThrow(PinReorderMismatchError);
    expect(() =>
      planPinReorder(existing, [
        { itemType: 'chat', itemId: 'chat-a' },
        { itemType: 'project', itemId: 'project-missing' },
      ]),
    ).toThrow(PinReorderMismatchError);
  });

  it('exposes a stable mismatch error name and message', () => {
    const error = new PinReorderMismatchError();

    expect(error.name).toBe('PinReorderMismatchError');
    expect(error.message).toBe(
      "Reorder must list exactly the caller's current pins",
    );
  });

  it('drops orphan pins, writes temporary and final positions, and returns hydrated rows', async () => {
    const orphan = { ...chatPin, itemId: 'chat-orphan' };
    const existingRows = [
      { itemType: chatPin.itemType, itemId: chatPin.itemId, position: 0 },
      { itemType: projectPin.itemType, itemId: projectPin.itemId, position: 1 },
      { itemType: orphan.itemType, itemId: orphan.itemId, position: 2 },
    ];
    const finalRows = [
      { ...projectPin, position: 0 },
      { ...chatPin, position: 1 },
    ];
    const db: Db = drizzle.mock({ schema });
    const selectResults = [
      selectResult(existingRows),
      selectResult([{ id: chatPin.itemId }]),
      selectResult([{ id: projectPin.itemId }]),
      selectResult(finalRows),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
      selectResult([
        { id: projectPin.itemId, name: 'Project', archivedAt: null },
      ]),
    ];
    // SAFETY: every fixture implements the exact select().from().where()
    // subset used by reorder() and its final listWithCards() read.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(selectResults));
    const deletes: Array<object> = [];
    // SAFETY: this fixture implements delete().where() and is awaited by
    // unpin() while removing the orphan.
    vi.spyOn(db, 'delete').mockImplementation(() => {
      const query = writeResult(undefined);
      deletes.push(query);
      // SAFETY: the query fixture above implements the exact fluent subset.
      return asDbQuery(query);
    });
    const updates: Array<object> = [];
    const setValues: Array<{ position: number }> = [];
    // SAFETY: this fixture implements update().set().where() and is awaited
    // once for each temporary and final position assignment.
    vi.spyOn(db, 'update').mockImplementation(() => {
      const query = writeResult(undefined, setValues);
      updates.push(query);
      // SAFETY: the query fixture above implements the exact fluent subset.
      return asDbQuery(query);
    });

    await expect(
      new PinsRepository(db).reorder('owner', [
        { itemType: 'project', itemId: projectPin.itemId },
        { itemType: 'chat', itemId: chatPin.itemId },
      ]),
    ).resolves.toEqual([
      {
        itemType: 'project',
        itemId: projectPin.itemId,
        pinnedAt: projectPin.pinnedAt,
        name: 'Project',
        archivedAt: null,
      },
      {
        itemType: 'chat',
        itemId: chatPin.itemId,
        pinnedAt: chatPin.pinnedAt,
        title: 'Chat',
        archivedAt: null,
      },
    ]);
    expect(deletes).toHaveLength(1);
    expect(updates).toHaveLength(4);
    expect(setValues).toEqual([
      { position: -2 },
      { position: -3 },
      { position: 0 },
      { position: 1 },
    ]);
  });

  it('reorders a chat-only set without querying project cards', async () => {
    const db: Db = drizzle.mock({ schema });
    const selectResults = [
      selectResult([
        { itemType: chatPin.itemType, itemId: chatPin.itemId, position: 0 },
      ]),
      selectResult([{ id: chatPin.itemId }]),
      selectResult([chatPin]),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
    ];
    // SAFETY: these fixtures implement the select chains used by reorder() and
    // its final chat-only listWithCards() read.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(selectResults));
    const updates: Array<object> = [];
    const setValues: Array<{ position: number }> = [];
    // SAFETY: this fixture implements update().set().where(), the exact chain
    // used for the two position assignments.
    vi.spyOn(db, 'update').mockImplementation(() => {
      const query = writeResult(undefined, setValues);
      updates.push(query);
      // SAFETY: the query fixture above implements the exact fluent subset.
      return asDbQuery(query);
    });

    await expect(
      new PinsRepository(db).reorder('owner', [
        { itemType: 'chat', itemId: chatPin.itemId },
      ]),
    ).resolves.toEqual([
      {
        itemType: 'chat',
        itemId: chatPin.itemId,
        pinnedAt: chatPin.pinnedAt,
        title: 'Chat',
        archivedAt: null,
      },
    ]);
    expect(updates).toHaveLength(2);
    expect(setValues).toEqual([{ position: -1 }, { position: 0 }]);
  });

  it('returns an empty result when reordering an empty set', async () => {
    const db: Db = drizzle.mock({ schema });
    const selectResults = [selectResult([]), selectResult([])];
    // SAFETY: these fixtures resolve the initial owner pin read and the final
    // listWithCards read with no rows.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(selectResults));

    await expect(new PinsRepository(db).reorder('owner', [])).resolves.toEqual(
      [],
    );
  });
});

describe('PinsRepository hydration and writes', () => {
  it('hydrates chat and project cards and drops an inaccessible pin', async () => {
    const db: Db = drizzle.mock({ schema });
    const results = [
      selectResult([chatPin, projectPin, { ...chatPin, itemId: 'missing' }]),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
      selectResult([
        { id: projectPin.itemId, name: 'Project', archivedAt: null },
      ]),
    ];
    // SAFETY: the repository only invokes `from().where()` and then awaits the
    // returned fluent value; these fixtures provide exactly that subset.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(results));

    await expect(
      new PinsRepository(db).listWithCards('owner'),
    ).resolves.toEqual([
      {
        itemType: 'chat',
        itemId: chatPin.itemId,
        pinnedAt: chatPin.pinnedAt,
        title: 'Chat',
        archivedAt: null,
      },
      {
        itemType: 'project',
        itemId: projectPin.itemId,
        pinnedAt: projectPin.pinnedAt,
        name: 'Project',
        archivedAt: null,
      },
    ]);
  });

  it('pins and hydrates a chat card after an idempotent insert', async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
      })),
    }));
    const db: Db = drizzle.mock({ schema });
    // SAFETY: the insert fixture implements the exact values/conflict chain
    // used by `PinsRepository.pin`, and its terminal promise is deterministic.
    vi.spyOn(db, 'insert').mockImplementation(() => asDbQuery(insert()));
    const results = [
      selectResult([chatPin]),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
    ];
    // SAFETY: the repository only invokes `from().where()` and then awaits the
    // returned fluent value; these fixtures provide exactly that subset.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(results));

    await expect(
      new PinsRepository(db).pin('owner', 'chat', chatPin.itemId),
    ).resolves.toMatchObject({
      itemType: 'chat',
      itemId: chatPin.itemId,
      title: 'Chat',
    });
    expect(insert).toHaveBeenCalledOnce();
  });

  it('pins and hydrates a project card after an idempotent insert', async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
      })),
    }));
    const db: Db = drizzle.mock({ schema });
    // SAFETY: the insert fixture implements the exact values/conflict chain
    // used by PinsRepository.pin, and its terminal promise is deterministic.
    vi.spyOn(db, 'insert').mockImplementation(() => asDbQuery(insert()));
    const results = [
      selectResult([projectPin]),
      selectResult([
        { id: projectPin.itemId, name: 'Project', archivedAt: null },
      ]),
    ];
    // SAFETY: these fixtures implement the select chains used by findOneWithCard
    // and the project-card lookup.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(results));

    await expect(
      new PinsRepository(db).pin('owner', 'project', projectPin.itemId),
    ).resolves.toMatchObject({
      itemType: 'project',
      itemId: projectPin.itemId,
      name: 'Project',
    });
    expect(insert).toHaveBeenCalledOnce();
  });

  it('hydrates a chat-only list without querying project cards', async () => {
    const db: Db = drizzle.mock({ schema });
    const results = [
      selectResult([chatPin]),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
    ];
    // SAFETY: these fixtures implement the select chains used by listWithCards
    // and its chat-card lookup.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(results));

    await expect(
      new PinsRepository(db).listWithCards('owner'),
    ).resolves.toEqual([
      {
        itemType: 'chat',
        itemId: chatPin.itemId,
        pinnedAt: chatPin.pinnedAt,
        title: 'Chat',
        archivedAt: null,
      },
    ]);
  });

  it('hydrates a project-only list without querying chat cards', async () => {
    const db: Db = drizzle.mock({ schema });
    const results = [
      selectResult([projectPin]),
      selectResult([
        { id: projectPin.itemId, name: 'Project', archivedAt: null },
      ]),
    ];
    // SAFETY: these fixtures implement the select chains used by listWithCards
    // and its project-card lookup.
    vi.spyOn(db, 'select').mockImplementation(() => nextSelect(results));

    await expect(
      new PinsRepository(db).listWithCards('owner'),
    ).resolves.toEqual([
      {
        itemType: 'project',
        itemId: projectPin.itemId,
        pinnedAt: projectPin.pinnedAt,
        name: 'Project',
        archivedAt: null,
      },
    ]);
  });

  it('returns undefined when a pin or its project card cannot be hydrated', async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
      })),
    }));
    const missingPinDb: Db = drizzle.mock({ schema });
    // SAFETY: the insert fixture implements the exact values/conflict chain
    // used by `PinsRepository.pin`, and its terminal promise is deterministic.
    vi.spyOn(missingPinDb, 'insert').mockImplementation(() =>
      asDbQuery(insert()),
    );
    // SAFETY: this fixture represents an empty owner-scoped pin query and
    // implements the fluent methods the repository invokes before awaiting it.
    vi.spyOn(missingPinDb, 'select').mockImplementation(() => selectResult([]));
    await expect(
      new PinsRepository(missingPinDb).pin(
        'owner',
        'project',
        projectPin.itemId,
      ),
    ).resolves.toBeUndefined();

    const missingCardDb: Db = drizzle.mock({ schema });
    // SAFETY: the insert fixture implements the exact values/conflict chain
    // used by `PinsRepository.pin`, and its terminal promise is deterministic.
    vi.spyOn(missingCardDb, 'insert').mockImplementation(() =>
      asDbQuery(insert()),
    );
    const missingCardResults = [selectResult([projectPin]), selectResult([])];
    // SAFETY: these fixtures implement the fluent select chain and resolve to
    // the deterministic pin row followed by an absent project card.
    vi.spyOn(missingCardDb, 'select').mockImplementation(() =>
      nextSelect(missingCardResults),
    );
    await expect(
      new PinsRepository(missingCardDb).pin(
        'owner',
        'project',
        projectPin.itemId,
      ),
    ).resolves.toBeUndefined();
  });

  it('unpins by all three owner and item coordinates', async () => {
    const { db, queries } = makeLoggedDb();

    await new PinsRepository(db)
      .unpin('owner', 'project', projectPin.itemId)
      .catch(() => undefined);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('"pins"."user_id" = $');
    expect(queries[0]?.sql).toContain('"pins"."item_type" = $');
    expect(queries[0]?.sql).toContain('"pins"."item_id" = $');
    expect(queries[0]?.params).toEqual(['owner', 'project', projectPin.itemId]);
  });
});
