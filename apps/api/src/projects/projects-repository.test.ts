import { ConflictException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Project } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

function makeMockDb() {
  const queries: Array<LoggedQuery> = [];

  const db: Db = drizzle.mock({
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });

  return { db, queries };
}

function projectRow(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-09-02T00:00:00.000Z');

  return {
    id: 'project-1',
    ownerUserId: 'owner',
    name: 'Project',
    description: null,
    instructions: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    defaultExecutorId: null,
    ...overrides,
  };
}

function terminalQuery<T>(value: T) {
  const terminal = Promise.resolve(value);
  const returning = vi.fn(() => terminal);
  const where = vi.fn(() => ({ returning }));

  return { where, returning };
}

function asDbQuery<T extends object>(query: T): never {
  // SAFETY: each test double implements the exact fluent methods used by the
  // repository and ends in a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

/**
 * Stand in for the owned-row `SELECT … FOR UPDATE` that update() takes before
 * its archive guard. Returns `row` (or no rows) and implements exactly the
 * fluent methods under test; persisted-state assertions live at the update
 * seam below.
 */
function mockLockedRow(db: Db, row: Project | undefined) {
  const rows = row === undefined ? [] : [row];
  const forUpdate = vi.fn(() => Promise.resolve(rows));
  const limit = vi.fn(() => ({ for: forUpdate }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));

  return vi.spyOn(db, 'select').mockImplementation(() => asDbQuery({ from }));
}

/**
 * Stand in for the owning UPDATE so assertions read the persisted row rather
 * than SQL text. The production patch-field logic still computes the SET
 * payload; this seam applies it to `row` and RETURNING hands the same fixture
 * back, exactly as the database would for the one locked row.
 */
function mockUpdateRow(db: Db, row: Project) {
  const returning = vi.fn(() => Promise.resolve([row]));
  const where = vi.fn(() => ({ returning }));

  const set = vi.fn((fields: Partial<Project>) => {
    Object.assign(row, fields);

    return { where };
  });

  vi.spyOn(db, 'update').mockImplementation(() => asDbQuery({ set }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);

  if (!query) throw new Error('expected a logged database query');

  return query;
}

describe('ProjectsRepository list ordering', () => {
  it('orders pinned-only projects by the owner pin position', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { pinned: 'only' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('inner join "pins"');
    expect(lastQuery(queries).sql).toContain(
      'order by "pins"."position" asc, "pins"."item_id"',
    );
    expect(lastQuery(queries).sql).not.toContain(
      'order by "projects"."updated_at"',
    );
  });

  it('keeps excluded pins on project activity order', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { pinned: 'exclude' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'order by "projects"."updated_at" desc',
    );
    expect(lastQuery(queries).sql).not.toContain('inner join "pins"');
  });

  it('filters to archived projects when archived is only', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { archived: 'only' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      '"projects"."archived_at" is not null',
    );
  });

  it('does not add an archive predicate when archived is with', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { archived: 'with' })
      .catch(() => null);

    expect(lastQuery(queries).sql).not.toContain(
      '"projects"."archived_at" is null',
    );
    expect(lastQuery(queries).sql).not.toContain(
      '"projects"."archived_at" is not null',
    );
  });
});

describe('ProjectsRepository update', () => {
  it('updates content and archive state, bumping updatedAt for a content change', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      {
        name: 'Renamed',
        description: 'Acme relaunch',
        archived: true,
      },
    );

    expect(updated?.name).toBe('Renamed');
    expect(updated?.description).toBe('Acme relaunch');
    expect(updated?.archivedAt).toBeInstanceOf(Date);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('clears the description with an explicit null and still bumps updatedAt', async () => {
    const { db } = makeMockDb();
    const current = projectRow({ description: 'Acme relaunch' });
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { description: null },
    );

    expect(updated?.description).toBeNull();
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('updates archive state without bumping updatedAt when content is unchanged', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const previousUpdatedAt = current.updatedAt;

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { archived: true },
    );

    expect(updated?.archivedAt).toBeInstanceOf(Date);
    expect(updated?.updatedAt).toBe(previousUpdatedAt);
  });

  it('allows pure unarchive and idempotent re-archive, but rejects archived content changes', async () => {
    const { db } = makeMockDb();
    const archivedAt = new Date('2026-09-01T00:00:00.000Z');
    const current = projectRow({ archivedAt });
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const repository = new ProjectsRepository(db);
    const previousUpdatedAt = current.updatedAt;

    // Pure unarchive: archive state alone and no content, so updatedAt stays.
    const unarchived = await repository.update(
      current.id,
      current.ownerUserId,
      { archived: false },
    );

    expect(unarchived?.archivedAt).toBeNull();
    expect(unarchived?.updatedAt).toBe(previousUpdatedAt);

    // Idempotent re-archive: an already archived row plus a pure archive patch
    // writes nothing, so the same row comes back untouched.
    current.archivedAt = archivedAt;

    const reArchived = await repository.update(
      current.id,
      current.ownerUserId,
      { archived: true },
    );

    expect(reArchived).toBe(current);
    expect(reArchived?.archivedAt).toBe(archivedAt);
    expect(reArchived?.updatedAt).toBe(previousUpdatedAt);

    // The guard's own `ConflictException`, not a message match.
    await expect(
      repository.update(current.id, current.ownerUserId, { name: 'Changed' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // The description is a content field too: an archived project refuses it
    // until it is unarchived, exactly like a rename.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        description: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // An archive transition carrying a content field is not a *pure* archive
    // write, so it is refused as well — one assertion per field, because the
    // guard reads both of them.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        archived: false,
        name: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      repository.update(current.id, current.ownerUserId, {
        archived: false,
        description: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      repository.update(current.id, current.ownerUserId, {
        archived: false,
        defaultExecutorId: 'host',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // The default executor is project content too: an archived project refuses
    // it, so a chat start cannot be redirected behind a frozen project.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        defaultExecutorId: 'host',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // A refused write persists nothing.
    expect(current.name).toBe('Project');
    expect(current.description).toBeNull();
    expect(current.defaultExecutorId).toBeNull();
    expect(current.archivedAt).toBe(archivedAt);
    expect(current.updatedAt).toBe(previousUpdatedAt);
  });

  it('writes the default executor and bumps updatedAt', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { defaultExecutorId: 'host' },
    );

    expect(updated?.defaultExecutorId).toBe('host');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('clears the default executor with an explicit null', async () => {
    const { db } = makeMockDb();
    const current = projectRow({ defaultExecutorId: 'host' });
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { defaultExecutorId: null },
    );

    expect(updated?.defaultExecutorId).toBeNull();
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('writes literal instructions exactly and bumps updatedAt', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const literal = '  Read @policy.md.\nNever run $review.\t';

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { instructions: literal },
    );

    // Literal data, not a normalized form: whitespace and import markers are
    // stored as-is. Whitespace-only → null is the service's decision, proven
    // at the service/HTTP boundary, so this layer must not re-trim.
    expect(updated?.instructions).toBe(literal);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('clears instructions with an explicit null and still bumps updatedAt', async () => {
    const { db } = makeMockDb();
    const current = projectRow({ instructions: 'Old guidance.' });
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { instructions: null },
    );

    expect(updated?.instructions).toBeNull();
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('leaves instructions out of the SET list when the patch omits them', async () => {
    const { db } = makeMockDb();
    const current = projectRow({ instructions: 'Keep me.' });
    mockLockedRow(db, current);
    mockUpdateRow(db, current);

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { name: 'Renamed' },
    );

    expect(updated?.name).toBe('Renamed');
    expect(updated?.instructions).toBe('Keep me.');
  });

  it('refuses instruction writes of either kind on an archived project', async () => {
    const { db } = makeMockDb();

    const archivedAt = new Date('2026-09-01T00:00:00.000Z');

    const current = projectRow({
      archivedAt,
      instructions: 'Frozen guidance.',
    });

    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const repository = new ProjectsRepository(db);
    const previousUpdatedAt = current.updatedAt;

    // Clearing is an instruction edit.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        instructions: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Any defined instruction value is project content to this layer, so even
    // a whitespace payload is refused rather than allowed to overwrite the
    // frozen text.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        instructions: '   ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // An archive transition carrying instructions is not a pure transition.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        archived: false,
        instructions: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(current.instructions).toBe('Frozen guidance.');
    expect(current.archivedAt).toBe(archivedAt);

    // A pure unarchive is still allowed: archive state alone and no content,
    // so the stored instructions survive and updatedAt does not move.
    const unarchived = await repository.update(
      current.id,
      current.ownerUserId,
      { archived: false },
    );

    expect(unarchived?.archivedAt).toBeNull();
    expect(unarchived?.instructions).toBe('Frozen guidance.');
    expect(unarchived?.updatedAt).toBe(previousUpdatedAt);
  });

  it('bumps updatedAt for a rename alone', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    mockUpdateRow(db, current);
    const beforeUpdate = Date.now();

    const updated = await new ProjectsRepository(db).update(
      current.id,
      current.ownerUserId,
      { name: 'Renamed' },
    );

    expect(updated?.name).toBe('Renamed');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('returns undefined when the owner-scoped current row is absent', async () => {
    const { db } = makeMockDb();
    mockLockedRow(db, undefined);

    await expect(
      new ProjectsRepository(db).update('missing', 'owner', { name: 'Nope' }),
    ).resolves.toBeUndefined();
  });

  it('returns the current row without writing for an empty patch', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    mockLockedRow(db, current);
    const update = vi.spyOn(db, 'update');

    await expect(
      new ProjectsRepository(db).update(current.id, current.ownerUserId, {}),
    ).resolves.toBe(current);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('ProjectsRepository delete', () => {
  it('returns true when a row is deleted and false when no row matches', async () => {
    const current = projectRow();
    const deletedDb: Db = drizzle.mock();
    // SAFETY: this query double implements exactly delete().where().returning().
    // The returned row count is the repository contract under test.
    vi.spyOn(deletedDb, 'delete').mockImplementation(() =>
      asDbQuery(terminalQuery([{ id: current.id }])),
    );
    await expect(
      new ProjectsRepository(deletedDb).delete(current.id, current.ownerUserId),
    ).resolves.toBe(true);

    const emptyDb: Db = drizzle.mock();
    // SAFETY: this query double implements exactly delete().where().returning().
    vi.spyOn(emptyDb, 'delete').mockImplementation(() =>
      asDbQuery(terminalQuery([])),
    );
    await expect(
      new ProjectsRepository(emptyDb).delete(current.id, current.ownerUserId),
    ).resolves.toBe(false);
  });
});
