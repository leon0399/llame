import { ConflictException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Project } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

function makeMockDb() {
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

function projectRow(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-09-02T00:00:00.000Z');
  return {
    id: 'project-1',
    ownerUserId: 'owner',
    name: 'Project',
    description: null,
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

  it('filters pinned exclude through an owner-scoped not-exists subquery', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { pinned: 'exclude' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('not exists');
    expect(lastQuery(queries).sql).toContain('"pins"."user_id" = $');
    expect(
      lastQuery(queries).params.filter((value) => value === 'owner'),
    ).toHaveLength(2);
    expect(lastQuery(queries).params).toContain('project');
  });
});

describe('ProjectsRepository update', () => {
  it('updates content and archive state, bumping updatedAt for a content change', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, {
        name: 'Renamed',
        description: 'Acme relaunch',
        archived: true,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('update "projects"');
    expect(lastQuery(queries).sql).toContain('"name" = $');
    expect(lastQuery(queries).sql).toContain('"description" = $');
    expect(lastQuery(queries).sql).toContain('"archived_at" = $');
    expect(lastQuery(queries).sql).toContain('"updated_at" = $');
  });

  it('clears the description with an explicit null and still bumps updatedAt', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow({ description: 'Acme relaunch' });
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, { description: null })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"description" = $');
    expect(lastQuery(queries).params).toContain(null);
    expect(lastQuery(queries).sql).toContain('"updated_at" = $');
  });

  it('updates archive state without bumping updatedAt when content is unchanged', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, { archived: true })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"archived_at" = $');
    expect(lastQuery(queries).sql).not.toContain('"updated_at" = $');
  });

  it('allows pure unarchive and idempotent re-archive, but rejects archived content changes', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow({
      archivedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );
    const repository = new ProjectsRepository(db);

    // The guard's own `ConflictException`, not a message match: the mock db
    // rejects every query with its SQL text, which names `archived_at`, so a
    // /archived/ pattern would also "pass" for a write the guard let through.
    await repository
      .update(current.id, current.ownerUserId, { archived: false })
      .catch(() => null);
    expect(lastQuery(queries).sql).toContain('"archived_at" = $');
    expect(lastQuery(queries).params).toContain(null);

    await expect(
      repository.update(current.id, current.ownerUserId, { archived: true }),
    ).resolves.toBe(current);

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
    // The default executor is project content too: an archived project refuses
    // it, so a chat start cannot be redirected behind a frozen project.
    await expect(
      repository.update(current.id, current.ownerUserId, {
        defaultExecutorId: 'host',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('writes the default executor and bumps updatedAt', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, { defaultExecutorId: 'host' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"default_executor_id" = $');
    expect(lastQuery(queries).sql).toContain('"updated_at" = $');
    expect(lastQuery(queries).params).toContain('host');
  });

  it('clears the default executor with an explicit null', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow({ defaultExecutorId: 'host' });
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, { defaultExecutorId: null })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"default_executor_id" = $');
    expect(lastQuery(queries).params).toContain(null);
  });

  it('bumps updatedAt for a rename alone', async () => {
    const { db, queries } = makeMockDb();
    const current = projectRow();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );

    await new ProjectsRepository(db)
      .update(current.id, current.ownerUserId, { name: 'Renamed' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"name" = $');
    expect(lastQuery(queries).sql).toContain('"updated_at" = $');
  });

  it('returns undefined when the owner-scoped current row is absent', async () => {
    const { db } = makeMockDb();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );

    await expect(
      new ProjectsRepository(db).update('missing', 'owner', { name: 'Nope' }),
    ).resolves.toBeUndefined();
  });

  it('returns the current row without writing for an empty patch', async () => {
    const { db } = makeMockDb();
    const current = projectRow();
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      current,
    );
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
    const deletedDb: Db = drizzle.mock({ schema });
    // SAFETY: this query double implements exactly delete().where().returning().
    // The returned row count is the repository contract under test.
    vi.spyOn(deletedDb, 'delete').mockImplementation(() =>
      asDbQuery(terminalQuery([{ id: current.id }])),
    );
    await expect(
      new ProjectsRepository(deletedDb).delete(current.id, current.ownerUserId),
    ).resolves.toBe(true);

    const emptyDb: Db = drizzle.mock({ schema });
    // SAFETY: this query double implements exactly delete().where().returning().
    vi.spyOn(emptyDb, 'delete').mockImplementation(() =>
      asDbQuery(terminalQuery([])),
    );
    await expect(
      new ProjectsRepository(emptyDb).delete(current.id, current.ownerUserId),
    ).resolves.toBe(false);
  });
});
