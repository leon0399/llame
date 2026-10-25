import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  type Checkout,
  type Project,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
} from '../db/schema';
import {
  resolveStartLocation,
  type StartLocationSource,
} from './start-location';

const INSTANT = new Date('2026-10-24T00:00:00.000Z');
const LATER = new Date('2026-10-24T01:00:00.000Z');
const OWNER = 'owner-a';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_REPOSITORY_ID = '33333333-3333-4333-8333-333333333333';

function projectRow(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    ownerUserId: OWNER,
    name: 'Project',
    description: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    archivedAt: null,
    defaultExecutorId: null,
    ...overrides,
  };
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

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: REPOSITORY_ID,
    ownerUserId: OWNER,
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
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

type Fixtures = {
  readonly links?: Array<ProjectRepository>;
  readonly repositories?: Array<Repository>;
  readonly checkouts?: Array<Checkout>;
  readonly defaults?: Array<ProjectRepositoryDefault>;
  /** Keyed `${root}|${executorId}`. */
  readonly boundChats?: Record<string, number>;
};

function makeSource(fixtures: Fixtures): StartLocationSource {
  const links = fixtures.links ?? [];
  const repositories = fixtures.repositories ?? [];
  const checkouts = fixtures.checkouts ?? [];
  const defaults = fixtures.defaults ?? [];
  return {
    listLinks: (owner, projectId) =>
      Promise.resolve(
        links.filter(
          (row) => row.ownerUserId === owner && row.projectId === projectId,
        ),
      ),
    findRepository: (owner, id) =>
      Promise.resolve(
        repositories.find((row) => row.ownerUserId === owner && row.id === id),
      ),
    findCheckout: (owner, id) =>
      Promise.resolve(
        checkouts.find((row) => row.ownerUserId === owner && row.id === id),
      ),
    findDefault: (owner, linkId, executorId) =>
      Promise.resolve(
        defaults.find(
          (row) =>
            row.ownerUserId === owner &&
            row.projectRepositoryId === linkId &&
            row.executorId === executorId,
        ),
      ),
    findLatestDefault: (owner, linkId) =>
      Promise.resolve(
        defaults
          .filter(
            (row) =>
              row.ownerUserId === owner && row.projectRepositoryId === linkId,
          )
          .sort(
            (left, right) =>
              right.updatedAt.getTime() - left.updatedAt.getTime(),
          )[0],
      ),
    listMainCheckouts: (owner, repositoryId, executorId) =>
      Promise.resolve(
        checkouts
          .filter(
            (row) =>
              row.ownerUserId === owner &&
              row.repositoryId === repositoryId &&
              row.kind === 'main' &&
              (executorId === undefined || row.executorId === executorId),
          )
          .sort(
            (left, right) =>
              left.executorId.localeCompare(right.executorId) ||
              left.path.localeCompare(right.path),
          ),
      ),
    countOpenChatsBoundTo: (owner, root, executorId) =>
      Promise.resolve(
        fixtures.boundChats?.[`${owner}|${root}|${executorId}`] ?? 0,
      ),
  };
}

describe('resolveStartLocation repository step', () => {
  it('resolves no repository when the project links none', async () => {
    await expect(
      resolveStartLocation(makeSource({}), OWNER, projectRow(), {}),
    ).resolves.toEqual({
      repositoryId: null,
      executorId: null,
      checkoutId: null,
      isolation: 'reuse',
      isolationReason: 'no_link',
      isolationChats: 0,
    });
  });

  it('prefers the primary link over the other links', async () => {
    const primary = linkRow({ isPrimary: true });
    const other = linkRow({
      id: '77777777-7777-4777-8777-777777777777',
      repositoryId: OTHER_REPOSITORY_ID,
      alias: 'notes',
    });

    const location = await resolveStartLocation(
      makeSource({ links: [other, primary] }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.repositoryId).toBe(REPOSITORY_ID);
  });

  it('takes the only link when no link is primary', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()] }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.repositoryId).toBe(REPOSITORY_ID);
  });

  it('resolves no repository when several links have no primary', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [
          linkRow(),
          linkRow({
            id: '77777777-7777-4777-8777-777777777777',
            repositoryId: OTHER_REPOSITORY_ID,
          }),
        ],
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.repositoryId).toBeNull();
    expect(location.isolationReason).toBe('no_link');
  });

  it('keeps the explicit repository of a chat without a project', async () => {
    // No project means no link, so the id proves the row is the caller's and
    // then stays resolved: the request's repository is the first step of the
    // order, with or without a project.
    await expect(
      resolveStartLocation(
        makeSource({
          repositories: [repositoryRow()],
          checkouts: [checkoutRow()],
        }),
        OWNER,
        null,
        { repositoryId: REPOSITORY_ID },
      ),
    ).resolves.toEqual({
      repositoryId: REPOSITORY_ID,
      executorId: 'host',
      checkoutId: checkoutRow().id,
      isolation: 'reuse',
      isolationReason: 'no_link',
      isolationChats: 0,
    });

    await expect(
      resolveStartLocation(makeSource({}), OWNER, null, {
        repositoryId: OTHER_REPOSITORY_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a repository the caller does not own', async () => {
    const resolution = resolveStartLocation(
      makeSource({ links: [linkRow()] }),
      OWNER,
      projectRow(),
      { repositoryId: OTHER_REPOSITORY_ID },
    );

    await expect(resolution).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolution).rejects.toThrow(
      `Repository ${OTHER_REPOSITORY_ID} not found`,
    );
  });

  it('resolves an owned repository the project does not link, without its policy', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        repositories: [repositoryRow({ id: OTHER_REPOSITORY_ID })],
      }),
      OWNER,
      projectRow(),
      { repositoryId: OTHER_REPOSITORY_ID },
    );

    // A project and a working directory are separate: the named repository
    // stands, and with no link there is no policy behind its isolation.
    expect(location.repositoryId).toBe(OTHER_REPOSITORY_ID);
    expect(location.isolationReason).toBe('no_link');
  });
});

describe('resolveStartLocation executor and checkout steps', () => {
  it('resolves a named checkout for a chat without a project', async () => {
    const checkout = checkoutRow();

    const location = await resolveStartLocation(
      makeSource({ checkouts: [checkout] }),
      OWNER,
      null,
      { checkoutId: checkout.id },
    );

    // Without a project there is no link to require, so the checkout resolves
    // itself: its repository and executor, and no isolation policy.
    expect(location).toEqual({
      repositoryId: REPOSITORY_ID,
      executorId: 'host',
      checkoutId: checkout.id,
      isolation: 'reuse',
      isolationReason: 'no_link',
      isolationChats: 0,
    });
  });

  it('reuses the most recently written default across executors', async () => {
    const older = checkoutRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const newer = checkoutRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      executorId: 'machine:nas',
      path: 'machine://nas/srv/llame',
    });
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts: [older, newer],
        defaults: [
          defaultRow({ checkoutId: older.id, updatedAt: INSTANT }),
          defaultRow({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            executorId: 'machine:nas',
            checkoutId: newer.id,
            updatedAt: LATER,
          }),
        ],
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.executorId).toBe('machine:nas');
    expect(location.checkoutId).toBe(newer.id);
  });

  it('lets an explicit executor override the remembered default', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts: [checkoutRow()],
        defaults: [
          defaultRow({
            executorId: 'machine:nas',
            checkoutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          }),
        ],
      }),
      OWNER,
      projectRow(),
      { executorId: 'host' },
    );

    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBe(checkoutRow().id);
  });

  it('reuses the remembered checkout of the named executor over its mains', async () => {
    const remembered = checkoutRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const other = checkoutRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts: [remembered, other],
        defaults: [defaultRow({ checkoutId: remembered.id })],
      }),
      OWNER,
      projectRow(),
      { executorId: 'host' },
    );

    // Two main checkouts on the executor leave no fallback: only the default
    // can name one.
    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBe(remembered.id);
  });

  it('falls back to the project default executor and its only main checkout', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkoutRow()] }),
      OWNER,
      projectRow({ defaultExecutorId: 'machine:nas' }),
      {},
    );

    expect(location.executorId).toBe('machine:nas');
    expect(location.checkoutId).toBeNull();
  });

  it('takes the lowest executor id that holds a main checkout', async () => {
    const host = checkoutRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const nas = checkoutRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      executorId: 'machine:nas',
    });
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [nas, host] }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBe(host.id);
  });

  it('resolves no checkout when the executor holds several main checkouts', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts: [
          checkoutRow(),
          checkoutRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        ],
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBeNull();
  });

  it('lets a named checkout decide its repository and executor', async () => {
    const checkout = checkoutRow({ executorId: 'machine:nas' });
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id },
    );

    expect(location).toMatchObject({
      repositoryId: REPOSITORY_ID,
      executorId: 'machine:nas',
      checkoutId: checkout.id,
    });
  });

  it('answers 422 for a worktree checkout', async () => {
    const worktree = checkoutRow({
      kind: 'worktree',
      parentCheckoutId: checkoutRow().id,
      path: '/srv/llame/.llame-worktrees/llame/wt',
    });
    const resolution = resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [worktree] }),
      OWNER,
      projectRow(),
      { checkoutId: worktree.id },
    );

    await expect(resolution).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(resolution).rejects.toThrow(
      'A worktree checkout cannot start a chat; name its main checkout.',
    );
  });

  it('answers 404 for a checkout the caller does not own', async () => {
    const missing = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const resolution = resolveStartLocation(
      makeSource({ links: [linkRow()] }),
      OWNER,
      projectRow(),
      { checkoutId: missing },
    );

    await expect(resolution).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolution).rejects.toThrow(`Checkout ${missing} not found`);
  });

  it('answers 422 when a named repository disagrees with the checkout', async () => {
    const checkout = checkoutRow();
    const resolution = resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id, repositoryId: OTHER_REPOSITORY_ID },
    );

    await expect(resolution).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(resolution).rejects.toThrow(
      'The named repository does not hold that checkout.',
    );
  });

  it('answers 422 when a named executor disagrees with the checkout', async () => {
    const checkout = checkoutRow();
    const resolution = resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id, executorId: 'machine:nas' },
    );

    await expect(resolution).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(resolution).rejects.toThrow(
      'The named executor does not hold that checkout.',
    );
  });

  it('resolves a named checkout the project does not link', async () => {
    const checkout = checkoutRow();
    const location = await resolveStartLocation(
      makeSource({ checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id },
    );

    expect(location.checkoutId).toBe(checkout.id);
    expect(location.executorId).toBe(checkout.executorId);
  });

  it('keeps the named checkout when another executor holds a main checkout', async () => {
    const named = checkoutRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      executorId: 'zulu',
    });
    const other = checkoutRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      executorId: 'alpha',
    });

    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [named, other] }),
      OWNER,
      projectRow(),
      { checkoutId: named.id },
    );

    expect(location).toMatchObject({
      executorId: 'zulu',
      checkoutId: named.id,
    });
  });

  it('accepts a named repository and executor that agree with the checkout', async () => {
    const checkout = checkoutRow();
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      {
        checkoutId: checkout.id,
        repositoryId: REPOSITORY_ID,
        executorId: checkout.executorId,
      },
    );

    expect(location).toMatchObject({
      repositoryId: REPOSITORY_ID,
      executorId: checkout.executorId,
      checkoutId: checkout.id,
    });
  });

  it('takes the link of the named checkout, not the first link', async () => {
    const checkout = checkoutRow();
    const other = linkRow({
      id: '77777777-7777-4777-8777-777777777777',
      repositoryId: OTHER_REPOSITORY_ID,
      alias: 'notes',
    });
    const owned = linkRow({ isolation: 'always_worktree' });

    const location = await resolveStartLocation(
      makeSource({ links: [other, owned], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id },
    );

    expect(location).toMatchObject({
      repositoryId: REPOSITORY_ID,
      isolation: 'worktree',
      isolationReason: 'project_policy',
    });
  });

  it('resolves an explicit linked repository and its policy', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow({ isolation: 'always_worktree' })],
        repositories: [repositoryRow()],
        checkouts: [checkoutRow()],
      }),
      OWNER,
      projectRow(),
      { repositoryId: REPOSITORY_ID },
    );

    expect(location).toMatchObject({
      repositoryId: REPOSITORY_ID,
      executorId: 'host',
      isolation: 'worktree',
    });
  });

  it('drops a stale remembered checkout on the named executor', async () => {
    const stale = defaultRow({
      checkoutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts: [checkoutRow()],
        defaults: [stale],
      }),
      OWNER,
      projectRow(),
      { executorId: 'host' },
    );

    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBeNull();
  });

  it('resolves no executor when the repository has no main checkout', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()] }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toMatchObject({
      repositoryId: REPOSITORY_ID,
      executorId: null,
      checkoutId: null,
    });
  });

  it('takes the lowest executor id even when the read is unordered', async () => {
    const host = checkoutRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const nas = checkoutRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      executorId: 'machine:nas',
    });
    const source: StartLocationSource = {
      ...makeSource({ links: [linkRow()], checkouts: [host, nas] }),
      listMainCheckouts: () => Promise.resolve([nas, host]),
    };

    const location = await resolveStartLocation(
      source,
      OWNER,
      projectRow(),
      {},
    );

    expect(location.executorId).toBe('host');
    expect(location.checkoutId).toBe(host.id);
  });
});

describe('resolveStartLocation isolation default', () => {
  const checkouts = [checkoutRow()];

  it('keeps reuse under a never policy', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow({ isolation: 'never' })],
        checkouts,
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toMatchObject({
      isolation: 'reuse',
      isolationReason: 'project_policy',
      isolationChats: 0,
    });
  });

  it('turns a worktree on under an always_worktree policy', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow({ isolation: 'always_worktree' })],
        checkouts,
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toMatchObject({
      isolation: 'worktree',
      isolationReason: 'project_policy',
    });
  });

  it('reuses an unused checkout under an inherit policy', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toMatchObject({
      isolation: 'reuse',
      isolationReason: 'project_policy',
      isolationChats: 0,
    });
  });

  it('turns a worktree on when another open chat binds the checkout', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts,
        boundChats: { [`${OWNER}|/srv/llame|host`]: 2 },
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toMatchObject({
      isolation: 'worktree',
      isolationReason: 'clone_in_use',
      isolationChats: 2,
    });
  });

  it('counts the chats bound to the checkout a remembered default names', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        checkouts,
        defaults: [defaultRow()],
        boundChats: { [`${OWNER}|/srv/llame|host`]: 1 },
      }),
      OWNER,
      projectRow(),
      {},
    );

    // The default's checkout is what the count is about; dropping it would let
    // a new chat share a tree another open chat already binds.
    expect(location).toMatchObject({
      checkoutId: checkoutRow().id,
      isolation: 'worktree',
      isolationReason: 'clone_in_use',
      isolationChats: 1,
    });
  });
});

describe('resolveStartLocation without a resolved repository', () => {
  it('keeps the executor the request names', async () => {
    const location = await resolveStartLocation(
      makeSource({}),
      OWNER,
      projectRow(),
      { executorId: 'machine:nas' },
    );

    expect(location).toEqual({
      repositoryId: null,
      executorId: 'machine:nas',
      checkoutId: null,
      isolation: 'reuse',
      isolationReason: 'no_link',
      isolationChats: 0,
    });
  });

  it('keeps the project default executor', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [] }),
      OWNER,
      projectRow({ defaultExecutorId: 'machine:nas' }),
      {},
    );

    expect(location).toMatchObject({
      repositoryId: null,
      executorId: 'machine:nas',
      checkoutId: null,
      isolationReason: 'no_link',
    });
  });
});

describe('resolveStartLocation repository and checkout edge cases', () => {
  it('lets an explicit repository override links that have no primary', async () => {
    const other = linkRow({
      id: '77777777-7777-4777-8777-777777777777',
      repositoryId: OTHER_REPOSITORY_ID,
      alias: 'notes',
    });
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow(), other],
        repositories: [
          repositoryRow(),
          repositoryRow({ id: OTHER_REPOSITORY_ID, displayName: 'notes' }),
        ],
      }),
      OWNER,
      projectRow(),
      { repositoryId: OTHER_REPOSITORY_ID },
    );

    expect(location.repositoryId).toBe(OTHER_REPOSITORY_ID);
  });

  it('keeps a named checkout of a repository beside the linked one', async () => {
    const checkout = checkoutRow({ repositoryId: OTHER_REPOSITORY_ID });

    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkout] }),
      OWNER,
      projectRow(),
      { checkoutId: checkout.id },
    );

    // The project's primary link does not override a named working directory.
    expect(location.repositoryId).toBe(OTHER_REPOSITORY_ID);
    expect(location.checkoutId).toBe(checkout.id);
  });

  it('drops a remembered default whose checkout is gone', async () => {
    const location = await resolveStartLocation(
      makeSource({
        links: [linkRow()],
        defaults: [
          defaultRow({
            executorId: 'machine:nas',
            checkoutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          }),
        ],
      }),
      OWNER,
      projectRow(),
      {},
    );

    expect(location).toEqual({
      repositoryId: REPOSITORY_ID,
      executorId: 'machine:nas',
      checkoutId: null,
      isolation: 'reuse',
      isolationReason: 'project_policy',
      isolationChats: 0,
    });
  });

  it('keeps the request executor when the link has no checkout on it', async () => {
    const location = await resolveStartLocation(
      makeSource({ links: [linkRow()], checkouts: [checkoutRow()] }),
      OWNER,
      projectRow(),
      { executorId: 'machine:nas' },
    );

    expect(location).toMatchObject({
      executorId: 'machine:nas',
      checkoutId: null,
    });
  });
});
