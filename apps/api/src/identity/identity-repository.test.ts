import { is, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import type { ExternalIdentity, Membership, OrgUnit } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { isRecord, type UnknownRecord } from '../unknown-record';
import {
  ExternalIdentitiesRepository,
  MembershipsRepository,
  MoveIntoOwnSubtreeError,
  OrgUnitsRepository,
} from './identity-repository';

const now = new Date('2026-09-01T00:00:00.000Z');
const root: OrgUnit = {
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  type: 'organization',
  name: 'Root',
  path: '11111111-1111-4111-8111-111111111111',
  createdBy: 'owner-1',
  settings: {},
  createdAt: now,
  updatedAt: now,
};
const child: OrgUnit = {
  ...root,
  id: '22222222-2222-4222-8222-222222222222',
  parentId: root.id,
  type: 'team',
  name: 'Child',
  path: `${root.path}/22222222-2222-4222-8222-222222222222`,
};
const membership: Membership = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: 'member-1',
  orgUnitId: root.id,
  role: 'member',
  createdAt: now,
};
const externalIdentity: ExternalIdentity = {
  id: '44444444-4444-4444-8444-444444444444',
  userId: 'owner-1',
  provider: 'github',
  externalSubject: 'subject-1',
  metadata: { login: 'owner' },
  createdAt: now,
};

type QueryRows = ReadonlyArray<
  | OrgUnit
  | Membership
  | ExternalIdentity
  | { orgUnitId: string; memberCount: number }
  | { orgUnitId: string; role: Membership['role'] }
  | { id: string }
>;
type QueryCall = { method: string; args: Array<unknown> };
type LoggedQuery = { sql: string; params: Array<unknown> };

/** A Promise fluent query double; every repository chain ends by awaiting it. */
function queryResult(value: QueryRows, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain =
    (method: string) =>
    (...args: Array<unknown>) => {
      calls.push({ method, args });
      return terminal;
    };
  return Object.assign(terminal, {
    from: chain('from'),
    where: chain('where'),
    orderBy: chain('orderBy'),
    limit: chain('limit'),
    for: chain('for'),
    groupBy: chain('groupBy'),
    innerJoin: chain('innerJoin'),
    values: chain('values'),
    set: chain('set'),
    returning: chain('returning'),
  });
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: repository tests replace Drizzle's terminal query with a thenable
  // that implements exactly the fluent methods these repositories call.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

function makeDb(options: {
  select?: Array<QueryRows>;
  insert?: Array<QueryRows>;
  update?: Array<QueryRows>;
  delete?: Array<QueryRows>;
}) {
  const db: Db = drizzle.mock({ schema });
  const selectResults = [...(options.select ?? [])];
  const insertResults = [...(options.insert ?? [])];
  const updateResults = [...(options.update ?? [])];
  const deleteResults = [...(options.delete ?? [])];
  const calls: Array<QueryCall> = [];
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
  const update = vi
    .spyOn(db, 'update')
    .mockImplementation(() =>
      asQuery(queryResult(updateResults.shift() ?? [], calls)),
    );
  const remove = vi
    .spyOn(db, 'delete')
    .mockImplementation(() =>
      asQuery(queryResult(deleteResults.shift() ?? [], calls)),
    );
  return { db, calls, select, insert, update, remove };
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

describe('OrgUnitsRepository', () => {
  it('creates roots and children with generated paths and returns selected rows', async () => {
    const rootDb = makeDb({ insert: [[root]] });
    await expect(
      new OrgUnitsRepository(rootDb.db).createRoot({
        name: 'Root',
        type: 'organization',
        createdBy: 'owner-1',
        settings: { region: 'eu' },
      }),
    ).resolves.toBe(root);

    const childDb = makeDb({ insert: [[child]] });
    await expect(
      new OrgUnitsRepository(childDb.db).createChild({
        parent: root,
        name: 'Child',
        type: 'team',
        createdBy: 'owner-1',
        settings: { region: 'eu' },
      }),
    ).resolves.toBe(child);
    expect(rootDb.insert).toHaveBeenCalledOnce();
    expect(childDb.insert).toHaveBeenCalledOnce();
    const rootValues = rootDb.calls.find(({ method }) => method === 'values')
      ?.args[0];
    if (!isRecord(rootValues)) {
      throw new Error('expected root insert values');
    }
    expect(rootValues['id']).toEqual(expect.any(String));
    expect(rootValues['path']).toEqual(expect.any(String));
    expect(rootValues['path']).toBe(rootValues['id']);
    const childValues = childDb.calls.find(({ method }) => method === 'values')
      ?.args[0];
    if (!isRecord(childValues)) {
      throw new Error('expected child insert values');
    }
    expect(childValues).toMatchObject({ parentId: root.id });
    expect(childValues['id']).toEqual(expect.any(String));
    expect(childValues['path']).toEqual(expect.any(String));
    expect(childValues['path']).toBe(
      `${root.path}/${String(childValues['id'])}`,
    );
  });

  it('reads one unit, visible units, and a path-bounded subtree', async () => {
    const { db, select } = makeDb({
      select: [[root], [root, child], [root, child]],
    });
    const repository = new OrgUnitsRepository(db);

    await expect(repository.findById(root.id)).resolves.toBe(root);
    await expect(repository.listVisible()).resolves.toEqual([root, child]);
    await expect(repository.findSubtree(root)).resolves.toEqual([root, child]);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it('binds id and subtree paths and orders visible units by path', async () => {
    const { db, queries } = makeLoggedDb();
    const repository = new OrgUnitsRepository(db);
    await repository.findById(root.id).catch(() => undefined);
    await repository.findSubtree(root).catch(() => []);
    await repository.listVisible().catch(() => []);

    expect(queries[0]?.sql).toContain('"org_units"."id" = $');
    expect(queries[0]?.params).toContain(root.id);
    expect(queries[1]?.sql).toContain('"org_units"."path" = $');
    expect(queries[1]?.sql).toContain('"org_units"."path" like $');
    expect(queries[1]?.params).toEqual([root.path, `${root.path}/%`]);
    expect(queries[2]?.sql).toContain('order by "org_units"."path" asc');
  });

  it('moves a subtree, moves a unit to root, and rejects an own-subtree target', async () => {
    const moveDb = makeDb({
      select: [[child], [root], [root], [child], [root]],
      update: [[], [child]],
    });
    await expect(
      new OrgUnitsRepository(moveDb.db).move({ id: child.id }, root),
    ).resolves.toBe(child);
    expect(moveDb.update).toHaveBeenCalledTimes(2);
    const moveSets = moveDb.calls
      .filter(({ method }) => method === 'set')
      .map(({ args }) => args[0]);
    expect(moveSets[0]).toHaveProperty('path');
    expect(moveSets[1]).toMatchObject({ parentId: root.id });

    const rootDb = makeDb({
      select: [[child], [root], [child]],
      update: [[], [root]],
    });
    await expect(
      new OrgUnitsRepository(rootDb.db).moveToRoot({ id: child.id }),
    ).resolves.toBe(root);
    expect(
      rootDb.calls.filter(({ method }) => method === 'set').at(-1)?.args[0],
    ).toMatchObject({ parentId: null });

    const cycleDb = makeDb({
      select: [[root], [child], [root], [root], [child]],
    });
    await expect(
      new OrgUnitsRepository(cycleDb.db).move({ id: root.id }, child),
    ).rejects.toBeInstanceOf(MoveIntoOwnSubtreeError);
  });

  it('returns undefined for missing structural rows and writes names/settings or deletes leaves', async () => {
    const missingMoveDb = makeDb({ select: [[], []] });
    await expect(
      new OrgUnitsRepository(missingMoveDb.db).moveToRoot({ id: root.id }),
    ).rejects.toThrow(/not found/);

    const writeDb = makeDb({
      update: [[child], [child]],
      delete: [[{ id: child.id }], []],
    });
    const repository = new OrgUnitsRepository(writeDb.db);
    await expect(repository.rename(child.id, 'Renamed')).resolves.toBe(child);
    await expect(
      repository.updateSettings(child.id, { color: 'blue' }),
    ).resolves.toBe(child);
    await expect(repository.delete(child.id)).resolves.toBe(true);
    await expect(repository.delete(child.id)).resolves.toBe(false);
    const writeSets = writeDb.calls
      .filter(({ method }) => method === 'set')
      .map(({ args }) => args[0]);
    expect(writeSets[0]).toMatchObject({ name: 'Renamed' });
    expect(writeSets[1]).toMatchObject({ settings: { color: 'blue' } });
  });
});

describe('MembershipsRepository', () => {
  it('handles grants, reads, role changes, and empty path lookups', async () => {
    const { db, select, insert, update } = makeDb({
      select: [[membership], [membership], [membership], [membership]],
      update: [[membership]],
    });
    const repository = new MembershipsRepository(db);

    await expect(
      repository.grant({
        userId: membership.userId,
        orgUnitId: membership.orgUnitId,
        role: membership.role,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.findByUserOnUnits(membership.userId, []),
    ).resolves.toEqual([]);
    await expect(
      repository.findByUserOnUnits(membership.userId, [root.id]),
    ).resolves.toEqual([membership]);
    await expect(repository.listByUser(membership.userId)).resolves.toEqual([
      membership,
    ]);
    await expect(repository.listByUnit(root.id)).resolves.toEqual([membership]);
    await expect(
      repository.findByUserAndUnit(membership.userId, root.id),
    ).resolves.toBe(membership);
    await expect(
      repository.changeRole(membership.userId, root.id, 'admin'),
    ).resolves.toBe(membership);
    expect(insert).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenCalledOnce();
  });

  it('summarizes counts and direct roles, including units with only one side present', async () => {
    const { db } = makeDb({
      select: [
        [
          { orgUnitId: root.id, memberCount: 2 },
          { orgUnitId: child.id, memberCount: 1 },
        ],
        [{ orgUnitId: root.id, role: 'owner' }],
      ],
    });
    const repository = new MembershipsRepository(db);

    await expect(repository.summarize('owner-1', [])).resolves.toEqual(
      new Map(),
    );
    await expect(
      repository.summarize('owner-1', [root.id, child.id]),
    ).resolves.toEqual(
      new Map([
        [root.id, { memberCount: 2, directRole: 'owner' }],
        [child.id, { memberCount: 1, directRole: null }],
      ]),
    );
  });

  it('reports whether a revoke removed a row', async () => {
    const { db } = makeDb({
      delete: [[{ id: membership.id }], []],
    });
    const repository = new MembershipsRepository(db);

    await expect(repository.revoke(membership.userId, root.id)).resolves.toBe(
      true,
    );
    await expect(repository.revoke(membership.userId, root.id)).resolves.toBe(
      false,
    );
  });
});

describe('ExternalIdentitiesRepository', () => {
  it('links, lists, and unlinks provider identities', async () => {
    const { db, select, insert, remove } = makeDb({
      insert: [[externalIdentity]],
      select: [[externalIdentity]],
    });
    const repository = new ExternalIdentitiesRepository(db);

    await expect(
      repository.link({
        userId: externalIdentity.userId,
        provider: externalIdentity.provider,
        externalSubject: externalIdentity.externalSubject,
        metadata: externalIdentity.metadata,
      }),
    ).resolves.toBe(externalIdentity);
    await expect(
      repository.listByUser(externalIdentity.userId),
    ).resolves.toEqual([externalIdentity]);
    await expect(
      repository.unlink(externalIdentity.userId, externalIdentity.id),
    ).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});

/** Ids of the rows locked FOR UPDATE, in acquisition order. */
function lockedIdsInOrder(calls: Array<QueryCall>): Array<string> {
  const dialect = new PgDialect();
  const ids: Array<string> = [];
  calls.forEach((call, index) => {
    if (call.method !== 'for') return;
    const predicate = calls[index - 1]?.args[0];
    if (!is(predicate, SQL)) {
      throw new Error('expected a where predicate before the row lock');
    }
    ids.push(String(dialect.sqlToQuery(predicate).params[0]));
  });
  return ids;
}

function insertValues(calls: Array<QueryCall>): UnknownRecord {
  const values = calls.find(({ method }) => method === 'values')?.args[0];
  if (!isRecord(values)) {
    throw new Error('expected insert values');
  }
  return values;
}

describe('OrgUnitsRepository insert shape', () => {
  it('defaults a root to organization and nests settings under their own key', async () => {
    const { db, calls } = makeDb({ insert: [[root]] });

    await new OrgUnitsRepository(db).createRoot({
      name: 'Root',
      createdBy: 'owner-1',
      settings: { region: 'eu' },
    });

    const values = insertValues(calls);
    // A root IS an organization, not the column default 'group'.
    expect(values['type']).toBe('organization');
    expect(values['settings']).toStrictEqual({ region: 'eu' });
    // `|| { settings }` would spread the raw record's own keys instead.
    expect(values).not.toHaveProperty('region');
  });

  it('keeps an explicit root type and omits settings entirely when absent', async () => {
    const { db, calls } = makeDb({ insert: [[root]] });

    await new OrgUnitsRepository(db).createRoot({
      name: 'Root',
      type: 'group',
      createdBy: 'owner-1',
    });

    const values = insertValues(calls);
    expect(values['type']).toBe('group');
    expect(values).not.toHaveProperty('settings');
  });

  it('carries a child type and settings through, and omits both when absent', async () => {
    const typed = makeDb({ insert: [[child]] });
    await new OrgUnitsRepository(typed.db).createChild({
      parent: root,
      name: 'Child',
      type: 'team',
      createdBy: 'owner-1',
      settings: { region: 'eu' },
    });
    const typedValues = insertValues(typed.calls);
    expect(typedValues['type']).toBe('team');
    expect(typedValues['settings']).toStrictEqual({ region: 'eu' });
    expect(typedValues).not.toHaveProperty('region');

    const bare = makeDb({ insert: [[child]] });
    await new OrgUnitsRepository(bare.db).createChild({
      parent: root,
      name: 'Child',
      createdBy: 'owner-1',
    });
    const bareValues = insertValues(bare.calls);
    // The column default owns the child type; no key must be written.
    expect(bareValues).not.toHaveProperty('type');
    expect(bareValues).not.toHaveProperty('settings');
  });
});

describe('OrgUnitsRepository tree-root locking', () => {
  it('locks the unit tree root FOR UPDATE before returning it', async () => {
    const { db, calls } = makeDb({ select: [[child], [root], [child]] });

    await expect(
      new OrgUnitsRepository(db).findByIdInLockedTree(child.id),
    ).resolves.toBe(child);

    // Reading without taking the tree mutex is the race D1/F4 exists to close.
    expect(lockedIdsInOrder(calls)).toStrictEqual([root.id]);
  });

  it('locks both implicated tree roots in sorted id order', async () => {
    const otherRoot: OrgUnit = {
      ...root,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      path: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const otherChild: OrgUnit = {
      ...child,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      parentId: otherRoot.id,
      path: `${otherRoot.path}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    };
    const { db, calls } = makeDb({
      select: [
        [otherChild],
        [child],
        [root],
        [otherRoot],
        [otherChild],
        [child],
      ],
      update: [[], [otherChild]],
    });

    await new OrgUnitsRepository(db).move({ id: otherChild.id }, child);

    // Discovery order is [otherRoot, root]; the lock order must be sorted, or
    // two concurrent cross-tree moves deadlock against each other.
    expect(lockedIdsInOrder(calls)).toStrictEqual([root.id, otherRoot.id]);
  });
});

describe('OrgUnitsRepository move guards', () => {
  it('names the missing unit when it vanished before the lock', async () => {
    const { db } = makeDb({ select: [[], [root], [root], [], [root]] });

    await expect(
      new OrgUnitsRepository(db).move({ id: 'missing-unit' }, root),
    ).rejects.toThrow('Org unit missing-unit not found');
  });

  it('names the missing destination parent', async () => {
    const { db } = makeDb({ select: [[child], [], [root], [child], []] });

    await expect(
      new OrgUnitsRepository(db).move(
        { id: child.id },
        { id: 'missing-parent', path: 'missing-parent' },
      ),
    ).rejects.toThrow('Org unit missing-parent not found');
  });

  it('rejects a destination sharing the unit path even under a different id', async () => {
    const twin: OrgUnit = {
      ...child,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };
    const { db } = makeDb({
      select: [[child], [twin], [root], [child], [twin]],
      update: [[], [child]],
    });

    await expect(
      new OrgUnitsRepository(db).move({ id: child.id }, twin),
    ).rejects.toThrow('Cannot move an org unit into its own subtree.');
  });
});

describe('OrgUnitsRepository subtree rebase SQL', () => {
  it('rewrites the path prefix with substr past the old prefix, bounded to it', async () => {
    const queries: Array<LoggedQuery> = [];
    const db: Db = drizzle.mock({
      schema,
      logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
    });
    const selectResults: Array<QueryRows> = [
      [child],
      [root],
      [root],
      [child],
      [root],
    ];
    vi.spyOn(db, 'select').mockImplementation(() =>
      asQuery(queryResult(selectResults.shift() ?? [], [])),
    );

    await new OrgUnitsRepository(db)
      .move({ id: child.id }, root)
      .catch(() => undefined);

    const rewrite = queries.find(({ sql }) => sql.startsWith('update'));
    // substr(text, int), NOT substring(x from y) — the POSIX-REGEX spelling
    // silently yields NULL (#44).
    expect(rewrite?.sql).toContain('substr(');
    // Cut PAST the old prefix; length - 1 would keep its last character.
    expect(rewrite?.params).toContain(child.path.length + 1);
    // The subtree bound, not an empty pattern that would match every row.
    expect(rewrite?.params).toContain(`${child.path}/%`);
  });

  it('returns the deleted ids so a blocked delete cannot report success', async () => {
    const { db, queries } = makeLoggedDb();

    await new OrgUnitsRepository(db).delete(child.id).catch(() => undefined);

    expect(queries[0]?.sql).toContain('returning "id"');
  });
});

describe('MembershipsRepository write shape', () => {
  it('sets exactly the new role', async () => {
    const { db, calls } = makeDb({ update: [[membership]] });

    await new MembershipsRepository(db).changeRole(
      'member-1',
      root.id,
      'admin',
    );

    expect(calls.find(({ method }) => method === 'set')?.args[0]).toStrictEqual(
      {
        role: 'admin',
      },
    );
  });

  it('returns the revoked ids so a denied revoke cannot report success', async () => {
    const { db, queries } = makeLoggedDb();

    await new MembershipsRepository(db)
      .revoke('member-1', root.id)
      .catch(() => undefined);

    expect(queries[0]?.sql).toContain('returning "id"');
  });
});
