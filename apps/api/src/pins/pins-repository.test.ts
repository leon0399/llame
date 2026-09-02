import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  PinReorderMismatchError,
  PinsRepository,
  planPinReorder,
} from './pins-repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

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
});

describe('PinsRepository hydration and writes', () => {
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

  function selectResult<T>(result: T) {
    const whereResult = Promise.resolve(result);
    void Object.assign(whereResult, {
      orderBy: vi.fn(() => whereResult),
      limit: vi.fn(() => whereResult),
    });
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => whereResult),
      })),
    };
  }

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
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(db, 'select').mockImplementation(() => results.shift() as never);

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
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(db, 'insert').mockImplementation(() => insert() as never);
    const results = [
      selectResult([chatPin]),
      selectResult([{ id: chatPin.itemId, title: 'Chat', archivedAt: null }]),
    ];
    // SAFETY: the repository only invokes `from().where()` and then awaits the
    // returned fluent value; these fixtures provide exactly that subset.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(db, 'select').mockImplementation(() => results.shift() as never);

    await expect(
      new PinsRepository(db).pin('owner', 'chat', chatPin.itemId),
    ).resolves.toMatchObject({
      itemType: 'chat',
      itemId: chatPin.itemId,
      title: 'Chat',
    });
    expect(insert).toHaveBeenCalledOnce();
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
    vi.spyOn(missingPinDb, 'insert').mockImplementation(
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      () => insert() as never,
    );
    // SAFETY: this fixture represents an empty owner-scoped pin query and
    // implements the fluent methods the repository invokes before awaiting it.
    vi.spyOn(missingPinDb, 'select').mockImplementation(
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      () => selectResult([]) as never,
    );
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
    vi.spyOn(missingCardDb, 'insert').mockImplementation(
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      () => insert() as never,
    );
    const missingCardResults = [selectResult([projectPin]), selectResult([])];
    // SAFETY: these fixtures implement the fluent select chain and resolve to
    // the deterministic pin row followed by an absent project card.
    vi.spyOn(missingCardDb, 'select').mockImplementation(
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      () => missingCardResults.shift() as never,
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
    const where = vi.fn(() => Promise.resolve());
    const remove = vi.fn(() => ({ where }));
    const db: Db = drizzle.mock({ schema });
    // SAFETY: the repository only invokes `delete().where()` and awaits its
    // terminal promise; this fixture implements that exact fluent subset.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(db, 'delete').mockImplementation(() => remove() as never);

    await expect(
      new PinsRepository(db).unpin('owner', 'project', projectPin.itemId),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });
});
