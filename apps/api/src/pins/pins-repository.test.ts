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
});
