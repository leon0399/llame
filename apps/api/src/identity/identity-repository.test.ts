import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import type { ExternalIdentity, Membership, OrgUnit } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
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

/** A Promise fluent query double; every repository chain ends by awaiting it. */
function queryResult(value: QueryRows) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    for: chain,
    groupBy: chain,
    innerJoin: chain,
    values: chain,
    set: chain,
    returning: () => terminal,
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
  const select = vi
    .spyOn(db, 'select')
    .mockImplementation(() =>
      asQuery(queryResult(selectResults.shift() ?? [])),
    );
  const insert = vi
    .spyOn(db, 'insert')
    .mockImplementation(() =>
      asQuery(queryResult(insertResults.shift() ?? [])),
    );
  const update = vi
    .spyOn(db, 'update')
    .mockImplementation(() =>
      asQuery(queryResult(updateResults.shift() ?? [])),
    );
  const remove = vi
    .spyOn(db, 'delete')
    .mockImplementation(() =>
      asQuery(queryResult(deleteResults.shift() ?? [])),
    );
  return { db, select, insert, update, remove };
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

  it('moves a subtree, moves a unit to root, and rejects an own-subtree target', async () => {
    const moveDb = makeDb({
      select: [[child], [root], [root], [child], [root]],
      update: [[], [child]],
    });
    await expect(
      new OrgUnitsRepository(moveDb.db).move({ id: child.id }, root),
    ).resolves.toBe(child);
    expect(moveDb.update).toHaveBeenCalledTimes(2);

    const rootDb = makeDb({
      select: [[child], [root], [child]],
      update: [[], [root]],
    });
    await expect(
      new OrgUnitsRepository(rootDb.db).moveToRoot({ id: child.id }),
    ).resolves.toBe(root);

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
