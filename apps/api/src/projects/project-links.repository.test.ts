import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ProjectRepository, type Repository } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ProjectLinksRepository } from './project-links.repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

const INSTANT = new Date('2026-10-24T00:00:00.000Z');
const OWNER = 'owner-a';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';

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

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);
  if (!query) throw new Error('expected a logged database query');
  return query;
}

function linkRow(
  overrides: Partial<ProjectRepository> = {},
): ProjectRepository {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    ownerUserId: OWNER,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    alias: 'llame',
    isPrimary: false,
    isolation: 'inherit',
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function repositoryRow(): Repository {
  return {
    id: REPOSITORY_ID,
    ownerUserId: OWNER,
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: INSTANT,
    updatedAt: INSTANT,
  };
}

function asDbQuery<T>(query: T): never {
  // SAFETY: the double implements exactly the fluent methods this repository
  // calls, and every terminal is a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function queryResult<T>(rows: Array<T>) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    values: chain,
    set: chain,
    onConflictDoNothing: chain,
    returning: chain,
  });
}

function makeStubDb(rows: {
  select?: Array<unknown>;
  insert?: Array<unknown>;
  update?: Array<unknown>;
  delete?: Array<unknown>;
}) {
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(db, 'select').mockImplementation(() =>
    asDbQuery(queryResult(rows.select ?? [])),
  );
  vi.spyOn(db, 'insert').mockImplementation(() =>
    asDbQuery(queryResult(rows.insert ?? [])),
  );
  vi.spyOn(db, 'update').mockImplementation(() =>
    asDbQuery(queryResult(rows.update ?? [])),
  );
  vi.spyOn(db, 'delete').mockImplementation(() =>
    asDbQuery(queryResult(rows.delete ?? [])),
  );
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectLinksRepository links', () => {
  it('lists the project links oldest first, scoped to the owner', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .listLinks(OWNER, PROJECT_ID)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "project_repositories"');
    expect(lastQuery(queries).sql).toContain('"owner_user_id" = $1');
    expect(lastQuery(queries).sql).toContain('"project_id" = $2');
    expect(lastQuery(queries).sql).toContain('"created_at" asc');
    expect(lastQuery(queries).params).toEqual([OWNER, PROJECT_ID]);
  });

  it('reads one link by repository within the project', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .findLinkByRepository(OWNER, PROJECT_ID, REPOSITORY_ID)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"repository_id" = $3');
    expect(lastQuery(queries).sql).toContain('limit $4');
    expect(lastQuery(queries).params).toEqual([
      OWNER,
      PROJECT_ID,
      REPOSITORY_ID,
      1,
    ]);
  });

  it('lets the unique triple decide a duplicate link', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .createLink({
        ownerUserId: OWNER,
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
        alias: 'llame',
        isPrimary: false,
        isolation: 'inherit',
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'insert into "project_repositories"',
    );
    // The conflict target is the unique key itself: a target-less clause would
    // also swallow the partial primary index, and an empty target would let a
    // duplicate past the guard.
    expect(lastQuery(queries).sql).toContain(
      'on conflict ("owner_user_id","project_id","repository_id") do nothing',
    );
    expect(lastQuery(queries).params).toEqual([
      OWNER,
      PROJECT_ID,
      REPOSITORY_ID,
      'llame',
      false,
      'inherit',
    ]);
  });

  it('clears every primary link of the project in one statement', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .clearPrimary(OWNER, PROJECT_ID)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('update "project_repositories"');
    // One statement clears the flag, so the partial unique index never sees
    // two primary rows between the clear and the new primary's insert.
    expect(lastQuery(queries).sql).toContain('"is_primary" = $1');
    expect(lastQuery(queries).sql).toContain('"is_primary" = $5');
    expect(lastQuery(queries).params).toEqual([
      false,
      expect.any(String),
      OWNER,
      PROJECT_ID,
      true,
    ]);
  });

  it('updates one link and stamps updated_at', async () => {
    const updated = linkRow({ isPrimary: true });
    const db = makeStubDb({ update: [updated] });

    await expect(
      new ProjectLinksRepository(db).updateLink(OWNER, updated.id, {
        isPrimary: true,
      }),
    ).resolves.toBe(updated);
  });

  it('writes only the patched columns and stamps updated_at', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .updateLink(OWNER, '44444444-4444-4444-8444-444444444444', {
        isPrimary: true,
      })
      .catch(() => null);

    // A dropped patch would silently leave the row unchanged while the
    // statement still reports success.
    expect(lastQuery(queries).sql).toContain(
      'set "is_primary" = $1, "updated_at" = $2',
    );
    expect(lastQuery(queries).params.slice(0, 2)).toEqual([
      true,
      expect.any(String),
    ]);
    expect(lastQuery(queries).params.slice(2)).toEqual([
      OWNER,
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('reports whether a link row was removed', async () => {
    const deleted = linkRow();
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .deleteLink(OWNER, PROJECT_ID, deleted.id)
      .catch(() => null);

    // The count comes from RETURNING: without the id column every delete
    // reports "nothing removed".
    expect(lastQuery(queries).sql).toMatch(/returning "id"$/u);
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ delete: [{ id: deleted.id }] }),
      ).deleteLink(OWNER, PROJECT_ID, deleted.id),
    ).resolves.toBe(true);
    await expect(
      new ProjectLinksRepository(makeStubDb({ delete: [] })).deleteLink(
        OWNER,
        PROJECT_ID,
        deleted.id,
      ),
    ).resolves.toBe(false);
  });

  it('reads one owner repository by id', async () => {
    const repository = repositoryRow();
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ select: [repository] }),
      ).findRepository(OWNER, repository.id),
    ).resolves.toBe(repository);
    await expect(
      new ProjectLinksRepository(makeStubDb({ select: [] })).findRepository(
        OWNER,
        'missing',
      ),
    ).resolves.toBeUndefined();
  });
});
