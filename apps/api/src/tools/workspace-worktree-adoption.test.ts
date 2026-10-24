import { type GitInspectSuccess } from '@workspace/git-executor';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Checkout, type Repository } from '../db/schema';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import {
  adoptSource,
  type AdoptionSource,
} from './workspace-worktree-adoption';

/*
 * Adoption on worktree entry (openspec `repositories`, "An unregistered source
 * clone is adopted on worktree entry"): the repository and main row an entry
 * needs, inserted or reused on their unique keys, and the lost-race paths two
 * concurrent adoptions of one clone produce.
 *
 * The catalog is stubbed at its own seam, so each race is the sequence of
 * answers a winner's committed rows give a loser, not a timing accident.
 */

const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');

/**
 * One catalog handle. Every method this suite calls is spied at its own
 * prototype seam, so the drizzle handle never reaches Postgres.
 */
const catalogHandle = new RepositoriesRepository(drizzle.mock({ schema }));

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 'repo-1',
    ownerUserId: 'owner-1',
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

let checkoutSequence = 0;

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  checkoutSequence += 1;
  return {
    id: `checkout-${checkoutSequence}`,
    ownerUserId: 'owner-1',
    repositoryId: 'repo-1',
    executorId: 'worktree-host',
    path: '/home/me/src/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'adopted',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function inspection(
  overrides: Partial<GitInspectSuccess> = {},
): GitInspectSuccess {
  return {
    status: 'ok',
    toplevel: '/home/me/src/llame',
    commonDir: '/home/me/src/llame/.git',
    linked: false,
    mainWorktree: null,
    remotes: [{ name: 'origin', url: 'git@github.com:leon0399/llame.git' }],
    branch: 'main',
    head: 'a'.repeat(40),
    ...overrides,
  };
}

function source(overrides: Partial<AdoptionSource> = {}): AdoptionSource {
  return {
    ownerUserId: 'owner-1',
    executorId: 'worktree-host',
    mainClone: '/home/me/src/llame',
    mainPath: '/home/me/src/llame',
    canonical: '/home/me/src/llame',
    inspection: inspection(),
    ...overrides,
  };
}

/** The catalog, stubbed at its own seam: an empty catalog by default. */
function catalog() {
  return {
    findCheckoutByPath: vi
      .spyOn(RepositoriesRepository.prototype, 'findCheckoutByPath')
      .mockResolvedValue(undefined),
    findRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepository')
      .mockResolvedValue(undefined),
    findRepositoryByRemote: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByRemote')
      .mockResolvedValue(undefined),
    findRepositoryByAlias: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByAlias')
      .mockResolvedValue(undefined),
    createRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repositoryRow()),
    createCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'createCheckout')
      .mockImplementation((input) => Promise.resolve(checkoutRow(input))),
    deleteRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'deleteRepository')
      .mockResolvedValue(true),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  checkoutSequence = 0;
});

describe('adoptSource', () => {
  it('reuses the recorded main row and its repository', async () => {
    const stubs = catalog();
    const main = checkoutRow({
      id: 'checkout-main',
      path: '/home/me/src/llame',
    });
    const repository = repositoryRow();
    stubs.findCheckoutByPath.mockResolvedValue(main);
    stubs.findRepository.mockResolvedValue(repository);

    await expect(adoptSource(catalogHandle, source())).resolves.toStrictEqual({
      main,
      repository,
    });
    expect(stubs.createRepository).not.toHaveBeenCalled();
    expect(stubs.createCheckout).not.toHaveBeenCalled();
    expect(stubs.deleteRepository).not.toHaveBeenCalled();
  });

  it('records a new repository and main row for an unregistered clone', async () => {
    const stubs = catalog();
    const created = repositoryRow({ id: 'repo-new' });
    stubs.createRepository.mockResolvedValue(created);
    stubs.createCheckout.mockImplementation((input) =>
      Promise.resolve(checkoutRow({ ...input, id: 'checkout-created' })),
    );

    const adopted = await adoptSource(catalogHandle, source());

    expect(adopted?.repository).toStrictEqual(created);
    expect(adopted?.main).toMatchObject({
      id: 'checkout-created',
      repositoryId: 'repo-new',
      kind: 'main',
      parentCheckoutId: null,
    });
    // The row names the repository this transaction inserted, so the winner
    // lookup never runs and nothing is dropped.
    expect(stubs.findRepository).not.toHaveBeenCalled();
    expect(stubs.deleteRepository).not.toHaveBeenCalled();
  });

  it('reuses a repository the owner already holds for the same remote', async () => {
    const stubs = catalog();
    const known = repositoryRow({ id: 'repo-known' });
    stubs.findRepositoryByRemote.mockResolvedValue(known);

    await expect(adoptSource(catalogHandle, source())).resolves.toMatchObject({
      repository: { id: 'repo-known' },
    });
    expect(stubs.createRepository).not.toHaveBeenCalled();
    expect(stubs.findRepositoryByAlias).not.toHaveBeenCalled();
  });

  it('reuses a repository recorded under an alias of the same remote', async () => {
    const stubs = catalog();
    const alias = repositoryRow({ id: 'repo-alias' });
    stubs.findRepositoryByAlias.mockResolvedValue(alias);

    await expect(adoptSource(catalogHandle, source())).resolves.toMatchObject({
      repository: { id: 'repo-alias' },
    });
    expect(stubs.createRepository).not.toHaveBeenCalled();
  });

  it('reuses the row a concurrent insert made when its own insert lost', async () => {
    const stubs = catalog();
    const late = repositoryRow({ id: 'repo-late' });
    stubs.findRepositoryByRemote
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(late);
    stubs.createRepository.mockResolvedValue(undefined);

    await expect(adoptSource(catalogHandle, source())).resolves.toMatchObject({
      repository: { id: 'repo-late' },
    });
  });

  it('drops its own repository when a concurrent adopter committed the main row first', async () => {
    const stubs = catalog();
    const winner = checkoutRow({
      id: 'checkout-winner',
      repositoryId: 'repo-winner',
    });
    stubs.findCheckoutByPath
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(winner);
    stubs.createCheckout.mockResolvedValue(undefined);
    stubs.createRepository.mockResolvedValue(
      repositoryRow({ id: 'repo-mine' }),
    );
    stubs.findRepository.mockResolvedValue(
      repositoryRow({ id: 'repo-winner' }),
    );

    const adopted = await adoptSource(catalogHandle, source());

    expect(adopted).toStrictEqual({
      main: winner,
      repository: repositoryRow({ id: 'repo-winner' }),
    });
    // This transaction inserted `repo-mine` for a main row that never landed,
    // so the parent/child pair keeps the repository the winner names.
    expect(stubs.deleteRepository).toHaveBeenCalledWith('owner-1', 'repo-mine');
  });

  it('keeps the winner repository when it adopted the same remote row', async () => {
    const stubs = catalog();
    const winner = checkoutRow({
      id: 'checkout-winner',
      repositoryId: 'repo-winner',
    });
    stubs.findCheckoutByPath
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(winner);
    stubs.createCheckout.mockResolvedValue(undefined);
    stubs.findRepositoryByRemote.mockResolvedValue(
      repositoryRow({ id: 'repo-mine' }),
    );
    stubs.findRepository.mockResolvedValue(
      repositoryRow({ id: 'repo-winner' }),
    );

    await expect(adoptSource(catalogHandle, source())).resolves.toMatchObject({
      repository: { id: 'repo-winner' },
    });
    // This transaction created nothing, so losing the race drops nothing.
    expect(stubs.createRepository).not.toHaveBeenCalled();
    expect(stubs.deleteRepository).not.toHaveBeenCalled();
  });

  it('answers nothing when the winner main row names a repository that is gone', async () => {
    const stubs = catalog();
    const winner = checkoutRow({
      id: 'checkout-winner',
      repositoryId: 'repo-gone',
    });
    stubs.findCheckoutByPath
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(winner);
    stubs.createCheckout.mockResolvedValue(undefined);
    stubs.findRepository.mockResolvedValue(undefined);

    await expect(adoptSource(catalogHandle, source())).resolves.toBeUndefined();
    expect(stubs.deleteRepository).not.toHaveBeenCalled();
  });

  it('refuses a recorded row that is not a main checkout', async () => {
    const stubs = catalog();
    stubs.findCheckoutByPath.mockResolvedValue(
      checkoutRow({
        id: 'checkout-child',
        kind: 'worktree',
        parentCheckoutId: 'checkout-parent',
        path: '/home/me/src/other',
      }),
    );
    stubs.findRepository.mockResolvedValue(repositoryRow());

    await expect(adoptSource(catalogHandle, source())).resolves.toBeUndefined();
    expect(stubs.createCheckout).not.toHaveBeenCalled();
  });

  it('records a linked source under the main clone it belongs to', async () => {
    const stubs = catalog();
    stubs.createCheckout.mockImplementation((input) =>
      Promise.resolve(
        input.path === '/home/me/src/llame'
          ? { ...checkoutRow(input), id: 'checkout-main' }
          : checkoutRow({ ...input, id: 'checkout-linked' }),
      ),
    );
    const adoption = source({
      canonical: '/home/me/src/other',
      inspection: inspection({
        linked: true,
        mainWorktree: '/home/me/src/llame',
        branch: 'llame/other',
      }),
    });

    const adopted = await adoptSource(catalogHandle, adoption);

    expect(adopted?.main).toMatchObject({ id: 'checkout-main' });
    expect(stubs.createCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/home/me/src/other',
        kind: 'worktree',
        parentCheckoutId: 'checkout-main',
        branch: 'llame/other',
        origin: 'adopted',
      }),
    );
  });

  it('records one row when the entered path is the main clone itself', async () => {
    const stubs = catalog();
    const adoption = source({
      inspection: inspection({
        linked: true,
        mainWorktree: '/home/me/src/llame',
      }),
    });

    await expect(adoptSource(catalogHandle, adoption)).resolves.toBeDefined();
    expect(stubs.createCheckout).toHaveBeenCalledOnce();
  });
});
