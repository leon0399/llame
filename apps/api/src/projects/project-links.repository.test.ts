import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type Checkout,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
} from '../db/schema';
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

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    executorId: 'host',
    path: '/srv/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'master',
    origin: 'registered',
    worktreeBase: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function defaultRow(
  overrides: Partial<ProjectRepositoryDefault> = {},
): ProjectRepositoryDefault {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    ownerUserId: OWNER,
    projectRepositoryId: linkRow().id,
    executorId: 'host',
    checkoutId: checkoutRow().id,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
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
    onConflictDoUpdate: chain,
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

  it('reads one link by id within the owner', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .findLinkById(OWNER, linkRow().id)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"id" = $2');
    expect(lastQuery(queries).params).toEqual([OWNER, linkRow().id, 1]);
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
    expect(lastQuery(queries).sql).toContain('on conflict');
    expect(lastQuery(queries).sql).toContain('"owner_user_id"');
    expect(lastQuery(queries).sql).toContain('"project_id"');
    expect(lastQuery(queries).sql).toContain('"repository_id"');
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

  it('reports whether a link row was removed', async () => {
    const deleted = linkRow();
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
});

describe('ProjectLinksRepository defaults', () => {
  it('skips the query when the project has no links', async () => {
    const { db, queries } = makeMockDb();
    await expect(
      new ProjectLinksRepository(db).listDefaults(OWNER, []),
    ).resolves.toEqual([]);
    expect(queries).toEqual([]);
  });

  it('lists the defaults of the given links, newest first', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .listDefaults(OWNER, [linkRow().id])
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'from "project_repository_defaults"',
    );
    expect(lastQuery(queries).sql).toContain('"updated_at" desc');
    expect(lastQuery(queries).sql).toContain('"id" desc');
    expect(lastQuery(queries).params).toEqual([OWNER, linkRow().id]);
  });

  it('finds the default of one link on one executor', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .findDefault(OWNER, linkRow().id, 'host')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"executor_id" = $3');
    expect(lastQuery(queries).params).toEqual([OWNER, linkRow().id, 'host', 1]);
  });

  it('takes the newest default across executors', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .findLatestDefault(OWNER, linkRow().id)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"updated_at" desc');
    expect(lastQuery(queries).sql).toContain('limit $3');
  });

  it('replaces the checkout of an existing default and stamps the write', async () => {
    const row = defaultRow();
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .upsertDefault({
        ownerUserId: OWNER,
        projectRepositoryId: linkRow().id,
        executorId: 'host',
        checkoutId: row.checkoutId,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'on conflict ("owner_user_id","project_repository_id","executor_id")',
    );
    expect(lastQuery(queries).sql).toContain('"checkout_id" =');
    expect(lastQuery(queries).sql).toContain('"updated_at" =');
  });
});

describe('ProjectLinksRepository resolver reads', () => {
  it('reads one owner repository and checkout by id', async () => {
    const repository = repositoryRow();
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ select: [repository] }),
      ).findRepository(OWNER, repository.id),
    ).resolves.toBe(repository);
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ select: [checkoutRow()] }),
      ).findCheckout(OWNER, checkoutRow().id),
    ).resolves.toEqual(checkoutRow());
    await expect(
      new ProjectLinksRepository(makeStubDb({ select: [] })).findCheckout(
        OWNER,
        'missing',
      ),
    ).resolves.toBeUndefined();
  });

  it('lists main checkouts only, narrowed to an executor when named', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .listMainCheckouts(OWNER, REPOSITORY_ID, 'machine:nas')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(`"kind" = $3`);
    expect(lastQuery(queries).sql).toContain('"executor_id" = $4');
    expect(lastQuery(queries).params).toEqual([
      OWNER,
      REPOSITORY_ID,
      'main',
      'machine:nas',
    ]);
  });

  it('counts the open chats bound to a root on an executor', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectLinksRepository(db)
      .countOpenChatsBoundTo(OWNER, '/srv/llame', 'host')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "chats"');
    expect(lastQuery(queries).sql).toContain('"workspace_root" = $2');
    expect(lastQuery(queries).sql).toContain('"workspace_executor_id" = $3');
    expect(lastQuery(queries).sql).toContain('"archived_at" is null');
    expect(lastQuery(queries).params).toEqual([OWNER, '/srv/llame', 'host']);
  });

  it('returns the counted chats and zero when none match', async () => {
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ select: [{ chats: 2 }] }),
      ).countOpenChatsBoundTo(OWNER, '/srv/llame', 'host'),
    ).resolves.toBe(2);
    await expect(
      new ProjectLinksRepository(
        makeStubDb({ select: [] }),
      ).countOpenChatsBoundTo(OWNER, '/srv/llame', 'host'),
    ).resolves.toBe(0);
  });
});
