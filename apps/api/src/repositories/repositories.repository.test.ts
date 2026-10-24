import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type Checkout,
  type Repository,
  type RepositoryAlias,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { RepositoriesRepository } from './repositories.repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

const INSTANT = new Date('2026-10-24T00:00:00.000Z');

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

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
    ownerUserId: 'owner-a',
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function aliasRow(overrides: Partial<RepositoryAlias> = {}): RepositoryAlias {
  return {
    id: '6a2f0f9e-2e0a-4b6f-9a8e-6f4a1c2d3e4f',
    ownerUserId: 'owner-a',
    repositoryId: repositoryRow().id,
    canonicalAlias: 'github.com/leon0399/llame-old',
    createdAt: INSTANT,
    ...overrides,
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '9d0c2b7a-5e4f-4c3b-8a2d-1f0e9d8c7b6a',
    ownerUserId: 'owner-a',
    repositoryId: repositoryRow().id,
    executorId: 'local',
    path: '/home/owner/llame',
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

/**
 * Drizzle's terminal builders carry private state no structural double can
 * satisfy, so a spy that replaces one hands its fluent Promise back through the
 * `never` bottom type.
 */
function asDbQuery<T>(query: T): never {
  // SAFETY: queryResult implements exactly the fluent methods this repository
  // calls, and every terminal is a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

/** A Promise fluent double covering every chain this repository uses. */
function queryResult<T>(rows: Array<T>) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    innerJoin: chain,
    values: chain,
    set: chain,
    onConflictDoNothing: chain,
    returning: chain,
  });
}

/**
 * Replaces the query builders whose returned rows the method maps into its
 * result, so the mapping is exercised without a database.
 */
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

describe('RepositoriesRepository catalog reads', () => {
  it('scopes the catalog to the owner and lists newest first', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .listRepositories('owner-a')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "repositories"');
    expect(lastQuery(queries).sql).toContain(
      '"repositories"."owner_user_id" = $1',
    );
    expect(lastQuery(queries).sql).toContain(
      'order by "repositories"."created_at" desc',
    );
    expect(lastQuery(queries).params).toEqual(['owner-a']);
  });

  it('reads one repository by owner and id with a single-row limit', async () => {
    const { db, queries } = makeMockDb();
    const repository = repositoryRow();
    await new RepositoriesRepository(db)
      .findRepository(repository.ownerUserId, repository.id)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('and "repositories"."id" = $2');
    expect(lastQuery(queries).sql).toContain('limit $3');
    expect(lastQuery(queries).params).toEqual([
      repository.ownerUserId,
      repository.id,
      1,
    ]);
  });

  it('returns the matching repository row and undefined when none matches', async () => {
    const repository = repositoryRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ select: [repository] }),
      ).findRepository('owner-a', repository.id),
    ).resolves.toBe(repository);

    await expect(
      new RepositoriesRepository(makeStubDb({ select: [] })).findRepository(
        'owner-a',
        'missing',
      ),
    ).resolves.toBeUndefined();
  });

  it('reads one repository by canonical remote within the owner', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .findRepositoryByRemote('owner-a', 'github.com/leon0399/llame')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      '"repositories"."canonical_remote" = $2',
    );
    expect(lastQuery(queries).sql).toContain('limit $3');
    expect(lastQuery(queries).params).toEqual([
      'owner-a',
      'github.com/leon0399/llame',
      1,
    ]);
  });
});

describe('RepositoriesRepository alias lookup', () => {
  it('joins the alias to its repository on the composite owner key', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .findRepositoryByAlias('owner-a', 'github.com/leon0399/llame-old')
      .catch(() => null);

    // The owner column is part of the join, not just the WHERE clause: a
    // repository reachable through another owner's alias would be a leak.
    expect(lastQuery(queries).sql).toContain('inner join "repositories" on');
    expect(lastQuery(queries).sql).toContain(
      '"repositories"."owner_user_id" = "repository_aliases"."owner_user_id"',
    );
    expect(lastQuery(queries).sql).toContain(
      '"repositories"."id" = "repository_aliases"."repository_id"',
    );
    expect(lastQuery(queries).sql).toContain(
      '"repository_aliases"."canonical_alias" = $2',
    );
    expect(lastQuery(queries).sql).toContain('limit $3');
    expect(lastQuery(queries).params).toEqual([
      'owner-a',
      'github.com/leon0399/llame-old',
      1,
    ]);
  });

  it('unwraps the joined repository and returns undefined for an absent alias', async () => {
    const repository = repositoryRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ select: [{ repository }] }),
      ).findRepositoryByAlias('owner-a', 'github.com/leon0399/llame-old'),
    ).resolves.toBe(repository);

    // An absent alias yields no rows, so the unwrap must survive the undefined
    // index rather than dereference it.
    await expect(
      new RepositoriesRepository(
        makeStubDb({ select: [] }),
      ).findRepositoryByAlias('owner-a', 'github.com/leon0399/llame-old'),
    ).resolves.toBeUndefined();
  });
});

describe('RepositoriesRepository catalog writes', () => {
  it('creates a repository with its owner and remote as the conflict key', async () => {
    const { db, queries } = makeMockDb();
    const repository = repositoryRow();
    await new RepositoriesRepository(db)
      .createRepository({
        ownerUserId: repository.ownerUserId,
        displayName: repository.displayName,
        canonicalRemote: repository.canonicalRemote,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('insert into "repositories"');
    // Without the explicit target, ON CONFLICT would swallow every constraint
    // violation, not only a second owner-bound claim of the same remote.
    expect(lastQuery(queries).sql).toContain(
      'on conflict ("owner_user_id","canonical_remote") do nothing',
    );
    expect(lastQuery(queries).params).toEqual([
      repository.ownerUserId,
      repository.displayName,
      repository.canonicalRemote,
    ]);
  });

  it('returns the created repository and undefined when the remote is already held', async () => {
    const repository = repositoryRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ insert: [repository] }),
      ).createRepository({
        ownerUserId: repository.ownerUserId,
        displayName: repository.displayName,
        canonicalRemote: repository.canonicalRemote,
      }),
    ).resolves.toBe(repository);

    await expect(
      new RepositoriesRepository(makeStubDb({ insert: [] })).createRepository({
        ownerUserId: repository.ownerUserId,
        displayName: repository.displayName,
        canonicalRemote: repository.canonicalRemote,
      }),
    ).resolves.toBeUndefined();
  });

  it('updates the patched columns and bumps updatedAt', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .updateRepository('owner-a', 'repo-1', {
        displayName: 'renamed',
        canonicalRemote: null,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('update "repositories" set');
    expect(lastQuery(queries).sql).toContain('"display_name" = $1');
    expect(lastQuery(queries).sql).toContain('"canonical_remote" = $2');
    // A rename must move updatedAt even when the caller did not send it.
    expect(lastQuery(queries).sql).toContain('"updated_at" = $3');
    expect(lastQuery(queries).params.slice(0, 2)).toEqual(['renamed', null]);
    expect(lastQuery(queries).params).toContain('owner-a');
    expect(lastQuery(queries).params).toContain('repo-1');
  });

  it('returns the updated row and undefined when the owner holds no such repository', async () => {
    const updated = repositoryRow({ displayName: 'renamed' });
    await expect(
      new RepositoriesRepository(
        makeStubDb({ update: [updated] }),
      ).updateRepository('owner-a', updated.id, { displayName: 'renamed' }),
    ).resolves.toBe(updated);

    await expect(
      new RepositoriesRepository(makeStubDb({ update: [] })).updateRepository(
        'owner-a',
        'missing',
        { displayName: 'renamed' },
      ),
    ).resolves.toBeUndefined();
  });

  it('returns the current row and writes nothing for an empty patch', async () => {
    const current = repositoryRow();
    const { db, queries } = makeMockDb();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(current);
    const update = vi.spyOn(db, 'update');

    // A PATCH with no fields is a read of the current row, not a write that
    // bumps updatedAt and tells every reader the repository changed.
    await expect(
      new RepositoriesRepository(db).updateRepository(
        current.ownerUserId,
        current.id,
        {},
      ),
    ).resolves.toBe(current);
    expect(update).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it('deletes by owner and id, returning only the id column', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .deleteRepository('owner-a', 'repo-1')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('delete from "repositories"');
    expect(lastQuery(queries).sql).toContain('returning "id"');
    expect(lastQuery(queries).params).toEqual(['owner-a', 'repo-1']);
  });

  it('reports whether a repository row was deleted', async () => {
    const repository = repositoryRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ delete: [{ id: repository.id }] }),
      ).deleteRepository(repository.ownerUserId, repository.id),
    ).resolves.toBe(true);

    // An empty result is the only signal that RLS or the id filter matched
    // nothing; the empty list itself must not read as a successful delete.
    await expect(
      new RepositoriesRepository(makeStubDb({ delete: [] })).deleteRepository(
        repository.ownerUserId,
        repository.id,
      ),
    ).resolves.toBe(false);
  });
});

describe('RepositoriesRepository alias writes', () => {
  it('declares an alias with its owner and alias as the conflict key', async () => {
    const { db, queries } = makeMockDb();
    const alias = aliasRow();
    await new RepositoriesRepository(db)
      .declareAlias({
        ownerUserId: alias.ownerUserId,
        repositoryId: alias.repositoryId,
        canonicalAlias: alias.canonicalAlias,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'insert into "repository_aliases"',
    );
    expect(lastQuery(queries).sql).toContain(
      'on conflict ("owner_user_id","canonical_alias") do nothing',
    );
    expect(lastQuery(queries).params).toEqual([
      alias.ownerUserId,
      alias.repositoryId,
      alias.canonicalAlias,
    ]);
  });

  it('returns the declared alias and undefined when the alias already exists', async () => {
    const alias = aliasRow();
    await expect(
      new RepositoriesRepository(makeStubDb({ insert: [alias] })).declareAlias({
        ownerUserId: alias.ownerUserId,
        repositoryId: alias.repositoryId,
        canonicalAlias: alias.canonicalAlias,
      }),
    ).resolves.toBe(alias);

    await expect(
      new RepositoriesRepository(makeStubDb({ insert: [] })).declareAlias({
        ownerUserId: alias.ownerUserId,
        repositoryId: alias.repositoryId,
        canonicalAlias: alias.canonicalAlias,
      }),
    ).resolves.toBeUndefined();
  });

  it('lists the aliases of one repository oldest first', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .listAliases('owner-a', 'repo-1')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "repository_aliases"');
    expect(lastQuery(queries).sql).toContain(
      '"repository_aliases"."repository_id" = $2',
    );
    expect(lastQuery(queries).sql).toContain(
      'order by "repository_aliases"."created_at" asc',
    );
    expect(lastQuery(queries).params).toEqual(['owner-a', 'repo-1']);
  });
});

describe('RepositoriesRepository checkouts', () => {
  it('lists every checkout of an owner in creation order with a stable tie-break', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .listCheckouts('owner-a')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "checkouts"');
    expect(lastQuery(queries).sql).not.toContain(
      '"checkouts"."repository_id" = $',
    );
    expect(lastQuery(queries).sql).toContain(
      'order by "checkouts"."created_at" asc, "checkouts"."id" asc',
    );
    expect(lastQuery(queries).params).toEqual(['owner-a']);
  });

  it('narrows the checkout list to one repository when asked', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .listCheckouts('owner-a', 'repo-1')
      .catch(() => null);

    // Dropping this predicate would hand one repository's page the checkouts
    // of every other repository the owner holds.
    expect(lastQuery(queries).sql).toContain(
      '"checkouts"."repository_id" = $2',
    );
    expect(lastQuery(queries).params).toEqual(['owner-a', 'repo-1']);
  });

  it('reads one checkout by owner and id with a single-row limit', async () => {
    const { db, queries } = makeMockDb();
    const checkout = checkoutRow();
    await new RepositoriesRepository(db)
      .findCheckout(checkout.ownerUserId, checkout.id)
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('and "checkouts"."id" = $2');
    expect(lastQuery(queries).sql).toContain('limit $3');
    expect(lastQuery(queries).params).toEqual([
      checkout.ownerUserId,
      checkout.id,
      1,
    ]);
  });

  it('returns the matching checkout row and undefined when none matches', async () => {
    const checkout = checkoutRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ select: [checkout] }),
      ).findCheckout(checkout.ownerUserId, checkout.id),
    ).resolves.toBe(checkout);

    await expect(
      new RepositoriesRepository(makeStubDb({ select: [] })).findCheckout(
        checkout.ownerUserId,
        'missing',
      ),
    ).resolves.toBeUndefined();
  });

  it('reads one checkout by owner, executor, and path', async () => {
    const { db, queries } = makeMockDb();
    const checkout = checkoutRow();
    await new RepositoriesRepository(db)
      .findCheckoutByPath(
        checkout.ownerUserId,
        checkout.executorId,
        checkout.path,
      )
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('"checkouts"."executor_id" = $2');
    expect(lastQuery(queries).sql).toContain('"checkouts"."path" = $3');
    // The path is unique per owner and executor, not per executor: the owner
    // column belongs in the same lookup.
    expect(lastQuery(queries).params).toEqual([
      checkout.ownerUserId,
      checkout.executorId,
      checkout.path,
      1,
    ]);
  });

  it('creates a checkout with owner, executor, and path as the conflict key', async () => {
    const { db, queries } = makeMockDb();
    const checkout = checkoutRow({
      kind: 'worktree',
      parentCheckoutId: 'parent-1',
    });
    await new RepositoriesRepository(db)
      .createCheckout({
        ownerUserId: checkout.ownerUserId,
        repositoryId: checkout.repositoryId,
        executorId: checkout.executorId,
        path: checkout.path,
        kind: checkout.kind,
        parentCheckoutId: checkout.parentCheckoutId,
        branch: checkout.branch,
        origin: checkout.origin,
      })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('insert into "checkouts"');
    // The owner is part of the key because every owner shares the local
    // executor and each Machine; without it a second owner's registration
    // would disclose the first owner's path as a conflict.
    expect(lastQuery(queries).sql).toContain(
      'on conflict ("owner_user_id","executor_id","path") do nothing',
    );
    expect(lastQuery(queries).params).toEqual([
      checkout.ownerUserId,
      checkout.repositoryId,
      checkout.executorId,
      checkout.path,
      checkout.kind,
      checkout.parentCheckoutId,
      checkout.branch,
      checkout.origin,
    ]);
  });

  it('returns the created checkout and undefined when the path is already held', async () => {
    const checkout = checkoutRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ insert: [checkout] }),
      ).createCheckout({
        ownerUserId: checkout.ownerUserId,
        repositoryId: checkout.repositoryId,
        executorId: checkout.executorId,
        path: checkout.path,
        kind: checkout.kind,
        parentCheckoutId: checkout.parentCheckoutId,
        branch: checkout.branch,
        origin: checkout.origin,
      }),
    ).resolves.toBe(checkout);

    await expect(
      new RepositoriesRepository(makeStubDb({ insert: [] })).createCheckout({
        ownerUserId: checkout.ownerUserId,
        repositoryId: checkout.repositoryId,
        executorId: checkout.executorId,
        path: checkout.path,
        kind: checkout.kind,
        parentCheckoutId: checkout.parentCheckoutId,
        branch: checkout.branch,
        origin: checkout.origin,
      }),
    ).resolves.toBeUndefined();
  });

  it('writes the worktree base and bumps updatedAt', async () => {
    const { db, queries } = makeMockDb();
    const checkout = checkoutRow();
    await new RepositoriesRepository(db)
      .setWorktreeBase(checkout.ownerUserId, checkout.id, '/home/owner/base')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('update "checkouts" set');
    expect(lastQuery(queries).sql).toContain('"worktree_base" = $1');
    expect(lastQuery(queries).sql).toContain('"updated_at" = $2');
    expect(lastQuery(queries).params[0]).toBe('/home/owner/base');
    expect(lastQuery(queries).params).toContain(checkout.id);
  });

  it('returns the checkout with the new base and undefined for a foreign id', async () => {
    const updated = checkoutRow({ worktreeBase: '/home/owner/base' });
    await expect(
      new RepositoriesRepository(
        makeStubDb({ update: [updated] }),
      ).setWorktreeBase(updated.ownerUserId, updated.id, '/home/owner/base'),
    ).resolves.toBe(updated);

    await expect(
      new RepositoriesRepository(makeStubDb({ update: [] })).setWorktreeBase(
        updated.ownerUserId,
        'missing',
        '/home/owner/base',
      ),
    ).resolves.toBeUndefined();
  });

  it('deletes a checkout by owner and id, returning only the id column', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .deleteCheckout('owner-a', 'checkout-1')
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('delete from "checkouts"');
    expect(lastQuery(queries).sql).toContain('returning "id"');
    expect(lastQuery(queries).params).toEqual(['owner-a', 'checkout-1']);
  });

  it('reports whether a checkout row was deleted', async () => {
    const checkout = checkoutRow();
    await expect(
      new RepositoriesRepository(
        makeStubDb({ delete: [{ id: checkout.id }] }),
      ).deleteCheckout(checkout.ownerUserId, checkout.id),
    ).resolves.toBe(true);

    await expect(
      new RepositoriesRepository(makeStubDb({ delete: [] })).deleteCheckout(
        checkout.ownerUserId,
        checkout.id,
      ),
    ).resolves.toBe(false);
  });
});

describe('RepositoriesRepository chatsBoundTo', () => {
  it('answers an empty map without querying when no paths are requested', async () => {
    const { db, queries } = makeMockDb();
    const bound = await new RepositoriesRepository(db).chatsBoundTo(
      'owner-a',
      [],
    );

    expect(bound.size).toBe(0);
    // With no path to compare against, the query could only scan the owner's
    // whole chat table; the short-circuit is the point of the guard.
    expect(queries).toEqual([]);
  });

  it('selects the owner chats whose workspace root is one of the paths', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .chatsBoundTo('owner-a', ['/repo', '/other'])
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "chats"');
    expect(lastQuery(queries).sql).toContain(
      '"chats"."workspace_root" in ($2, $3)',
    );
    expect(lastQuery(queries).sql).toContain(
      'order by "chats"."created_at" asc, "chats"."id" asc',
    );
    expect(lastQuery(queries).params).toEqual(['owner-a', '/repo', '/other']);
  });

  it('groups chat ids by root and skips chats without a workspace root', async () => {
    const db = makeStubDb({
      select: [
        { id: 'chat-1', root: '/repo' },
        { id: 'chat-2', root: '/repo' },
        { id: 'chat-3', root: '/other' },
        { id: 'chat-4', root: null },
      ],
    });
    const bound = await new RepositoriesRepository(db).chatsBoundTo('owner-a', [
      '/repo',
      '/other',
    ]);

    // Several chats may bind one root; the map keeps all of them in query
    // order, and a NULL root matches no checkout so it must not become a key.
    expect([...bound.entries()]).toEqual([
      ['/repo', ['chat-1', 'chat-2']],
      ['/other', ['chat-3']],
    ]);
  });
});

describe('RepositoriesRepository leaseChats', () => {
  it('answers an empty map without querying when no checkouts are requested', async () => {
    const { db, queries } = makeMockDb();
    const leases = await new RepositoriesRepository(db).leaseChats(
      'owner-a',
      [],
    );

    expect(leases.size).toBe(0);
    expect(queries).toEqual([]);
  });

  it('selects the owner leases of the requested checkouts in creation order', async () => {
    const { db, queries } = makeMockDb();
    await new RepositoriesRepository(db)
      .leaseChats('owner-a', ['checkout-1', 'checkout-2'])
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('from "worktree_leases"');
    expect(lastQuery(queries).sql).toContain(
      '"worktree_leases"."checkout_id" in ($2, $3)',
    );
    expect(lastQuery(queries).sql).toContain(
      'order by "worktree_leases"."created_at" asc, "worktree_leases"."id" asc',
    );
    expect(lastQuery(queries).params).toEqual([
      'owner-a',
      'checkout-1',
      'checkout-2',
    ]);
  });

  it('keeps the earliest lease chat when a checkout has several leases', async () => {
    const db = makeStubDb({
      select: [
        { checkoutId: 'checkout-1', chatId: 'chat-earliest' },
        { checkoutId: 'checkout-1', chatId: 'chat-later' },
        { checkoutId: 'checkout-2', chatId: 'chat-other' },
      ],
    });
    const leases = await new RepositoriesRepository(db).leaseChats('owner-a', [
      'checkout-1',
      'checkout-2',
    ]);

    // A second chat may bind a leased path, so the receipt list holds several
    // rows per checkout; only the first (oldest) lease answers for it.
    expect([...leases.entries()]).toEqual([
      ['checkout-1', 'chat-earliest'],
      ['checkout-2', 'chat-other'],
    ]);
  });
});
