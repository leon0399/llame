import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type KnowledgeSpace } from '../db/schema/knowledge-spaces';
import { type Db } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';

const OWNER_ID = 'owner-a';
const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';
const NOW = new Date('2026-08-23T12:00:00.000Z');

type Row = { id: string } | KnowledgeSpace;

function fakeDb(input: {
  selects: Array<Array<Row>>;
  inserted?: Array<Row>;
  events: Array<string>;
  onConflict: ReturnType<typeof vi.fn>;
}): Db {
  let selectIndex = 0;
  const db = drizzle.mock();
  Object.assign(db, {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = input.selects[selectIndex++] ?? [];

          const limit = () => {
            input.events.push('select');

            return Promise.resolve(rows);
          };

          const orderedLimit = () => {
            input.events.push('select:ordered');

            return Promise.resolve(rows);
          };

          return {
            for: (mode: string) => ({
              limit: () => {
                input.events.push(`select:${mode}`);

                return Promise.resolve(rows);
              },
            }),
            limit,
            orderBy: () => ({
              for: (mode: string) => ({
                limit: () => {
                  input.events.push(`select:ordered:${mode}`);

                  return Promise.resolve(rows);
                },
              }),
              limit: orderedLimit,
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: input.onConflict,
      }),
    }),
  });

  input.onConflict.mockImplementation(() => ({
    returning: () => {
      input.events.push('insert');

      return Promise.resolve(input.inserted ?? []);
    },
  }));

  return db;
}

describe('KnowledgeSpaceRepository.createOrGet', () => {
  it('locks the owner before reading and does not insert when a space exists', async () => {
    const events: Array<string> = [];

    const existing = {
      knowledgeSpaceId: SPACE_ID,
      ownerUserId: OWNER_ID,
      name: 'Personal',
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };

    const onConflict = vi.fn();

    const repository = new KnowledgeSpaceRepository(
      fakeDb({ selects: [[{ id: OWNER_ID }], [existing]], events, onConflict }),
    );

    await expect(repository.createOrGet(OWNER_ID)).resolves.toEqual(existing);
    expect(events).toEqual(['select:update', 'select:ordered']);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('uses targetless conflict handling and rereads after a conflict', async () => {
    const events: Array<string> = [];

    const existing = {
      knowledgeSpaceId: SPACE_ID,
      ownerUserId: OWNER_ID,
      name: 'Personal',
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };

    const onConflict = vi.fn();

    const repository = new KnowledgeSpaceRepository(
      fakeDb({
        selects: [[{ id: OWNER_ID }], [], [existing]],
        inserted: [],
        events,
        onConflict,
      }),
    );

    await expect(repository.createOrGet(OWNER_ID)).resolves.toEqual(existing);
    expect(events).toEqual([
      'select:update',
      'select:ordered',
      'insert',
      'select:ordered',
    ]);
    expect(onConflict).toHaveBeenCalledWith();
  });
});

type ArchiveWrite = {
  archivedAt: Date | null;
  updatedAt: Date;
};

const dialect = new PgDialect();

function sqlText(clause: SQL): string {
  return dialect.sqlToQuery(clause).sql;
}

describe('KnowledgeSpaceRepository archive scope', () => {
  function listDb() {
    const wheres: Array<SQL> = [];
    const db = drizzle.mock();
    Object.assign(db, {
      select: () => ({
        from: () => ({
          where: (clause: SQL) => {
            wheres.push(clause);

            return {
              orderBy: () => ({
                limit: () => Promise.resolve([]),
              }),
            };
          },
        }),
      }),
    });

    return { db, wheres };
  }

  it('filters the page by archive scope', async () => {
    const { db, wheres } = listDb();
    const repository = new KnowledgeSpaceRepository(db);

    await repository.listForOwnerPage(OWNER_ID, 10, undefined, 'only');
    await repository.listForOwnerPage(OWNER_ID, 10, undefined, 'with');
    await repository.listForOwnerPage(OWNER_ID, 10);

    const [only, both, active] = wheres;

    if (only === undefined || both === undefined || active === undefined) {
      throw new Error('Expected three archive-scope queries');
    }

    expect(sqlText(only)).toContain('is not null');
    expect(sqlText(both)).not.toContain('archived_at');
    expect(sqlText(active)).toContain('is null');
    expect(sqlText(active)).not.toContain('is not null');
  });

  it('writes archivedAt when archiving and clears it when restoring', async () => {
    const sets: Array<ArchiveWrite> = [];
    const db = drizzle.mock();
    Object.assign(db, {
      update: () => ({
        set: (value: ArchiveWrite) => {
          sets.push(value);

          return {
            where: () => ({
              returning: () => Promise.resolve([]),
            }),
          };
        },
      }),
    });
    const repository = new KnowledgeSpaceRepository(db);

    await repository.setArchived(SPACE_ID, OWNER_ID, true);
    await repository.setArchived(SPACE_ID, OWNER_ID, false);

    expect(sets[0]?.archivedAt).toBeInstanceOf(Date);
    expect(sets[0]?.updatedAt).toBeInstanceOf(Date);
    expect(sets[1]?.archivedAt).toBeNull();
    expect(sets[1]?.updatedAt).toBeInstanceOf(Date);
  });

  it('locks the row and writes a name only while it is active', async () => {
    const modes: Array<string> = [];
    const wheres: Array<SQL> = [];
    const db = drizzle.mock();
    Object.assign(db, {
      select: () => ({
        from: () => ({
          where: (clause: SQL) => {
            wheres.push(clause);

            return {
              for: (mode: string) => {
                modes.push(mode);

                return { limit: () => Promise.resolve([]) };
              },
              limit: () => {
                modes.push('unlocked');

                return Promise.resolve([]);
              },
            };
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: (clause: SQL) => {
            wheres.push(clause);

            return { returning: () => Promise.resolve([]) };
          },
        }),
      }),
    });
    const repository = new KnowledgeSpaceRepository(db);

    await repository.findByIdForOwnerForUpdate(SPACE_ID, OWNER_ID);
    await repository.updateName(SPACE_ID, OWNER_ID, 'Field notes');

    const renameWhere = wheres[1];

    if (renameWhere === undefined) {
      throw new Error('Expected the rename predicate');
    }

    expect(modes).toEqual(['update']);
    expect(sqlText(renameWhere)).toContain('is null');
  });
});
