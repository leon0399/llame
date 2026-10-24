import { type GitInspectSuccess } from '@workspace/git-executor';

import { type Checkout, type Repository } from '../db/schema';
import { derivedDisplayName } from '../repositories/display-name';
import { canonicalOrigin } from '../repositories/remote';
import { RepositoriesRepository } from '../repositories/repositories.repository';

/*
 * Adoption on worktree entry (openspec `repositories`, "An unregistered source
 * clone is adopted on worktree entry").
 *
 * A `worktree` call needs a repository and a main checkout row, and the owner
 * may hold neither. Every write here is an insert or a select on a unique key,
 * inside the call's own fenced transaction, so two concurrent adoptions of one
 * clone end with one repository and one main row: the loser reads the winner's
 * committed row. Adoption creates no project link.
 */

/** The inspected facts one adoption records. */
export type AdoptionSource = {
  readonly ownerUserId: string;
  readonly executorId: string;
  /** The main tree git reports, where the main row is stored. */
  readonly mainClone: string;
  /** The executor's own path for the main clone, which names a remote-less repository. */
  readonly mainPath: string;
  /** The canonical address the call entered, which may be a linked worktree. */
  readonly canonical: string;
  readonly inspection: GitInspectSuccess;
};

/**
 * The repository and main checkout of one source clone, inserted or reused on
 * their unique keys. A source git reports as a linked worktree records that
 * worktree too, under the main clone it belongs to.
 */
export async function adoptSource(
  catalog: RepositoriesRepository,
  adoption: AdoptionSource,
): Promise<
  { readonly main: Checkout; readonly repository: Repository } | undefined
> {
  const recorded = await catalog.findCheckoutByPath(
    adoption.ownerUserId,
    adoption.executorId,
    adoption.mainClone,
  );
  const adopted = await resolveAdoption(catalog, adoption, recorded);
  if (adopted.repository === undefined) return undefined;
  const main =
    recorded ??
    (await adoptRow(catalog, {
      ownerUserId: adoption.ownerUserId,
      repositoryId: adopted.repository.id,
      executorId: adoption.executorId,
      path: adoption.mainClone,
      kind: 'main',
      parentCheckoutId: null,
      branch: null,
    }));
  if (main === undefined || main.kind !== 'main') return undefined;
  const repository = await repositoryOfMain(catalog, adoption, main, {
    repository: adopted.repository,
    created: adopted.created,
  });
  if (repository === undefined) return undefined;
  if (adoption.inspection.linked) {
    await adoptLinkedSource(catalog, adoption, main, repository);
  }
  return { main, repository };
}

/** The recorded repository, or the one this transaction adopts. */
async function resolveAdoption(
  catalog: RepositoriesRepository,
  adoption: AdoptionSource,
  recorded: Checkout | undefined,
): Promise<{
  readonly repository: Repository | undefined;
  readonly created: boolean;
}> {
  if (recorded === undefined) return adoptRepository(catalog, adoption);
  return {
    repository: await catalog.findRepository(
      adoption.ownerUserId,
      recorded.repositoryId,
    ),
    created: false,
  };
}

/**
 * The repository the winning main row names. A concurrent adopter of a
 * remote-less clone commits its main row first, so the repository this
 * transaction inserted for it is an orphan: drop it and keep the parent/child
 * pair under the repository the main row already names.
 */
async function repositoryOfMain(
  catalog: RepositoriesRepository,
  adoption: AdoptionSource,
  main: Checkout,
  adopted: { readonly repository: Repository; readonly created: boolean },
): Promise<Repository | undefined> {
  if (main.repositoryId === adopted.repository.id) return adopted.repository;
  const winner = await catalog.findRepository(
    adoption.ownerUserId,
    main.repositoryId,
  );
  if (winner !== undefined && adopted.created) {
    await catalog.deleteRepository(adoption.ownerUserId, adopted.repository.id);
  }
  return winner;
}

/**
 * A source git reports as a linked worktree records that worktree under the
 * main clone it belongs to, so the catalog names the tree the owner entered
 * rather than only the clone behind it.
 */
async function adoptLinkedSource(
  catalog: RepositoriesRepository,
  adoption: AdoptionSource,
  main: Checkout,
  repository: Repository,
): Promise<void> {
  if (adoption.canonical === adoption.mainClone) return;
  await adoptRow(catalog, {
    ownerUserId: adoption.ownerUserId,
    repositoryId: repository.id,
    executorId: adoption.executorId,
    path: adoption.canonical,
    kind: 'worktree',
    parentCheckoutId: main.id,
    branch: adoption.inspection.branch,
  });
}

/**
 * The repository of one unregistered clone, by remote, alias, or a new row.
 * `created` tells the caller whether this transaction inserted the row, which
 * is the only case a lost race may delete it.
 */
async function adoptRepository(
  catalog: RepositoriesRepository,
  adoption: AdoptionSource,
): Promise<{
  readonly repository: Repository | undefined;
  readonly created: boolean;
}> {
  const remote = canonicalOrigin(adoption.inspection.remotes);
  if (remote !== null) {
    const existing =
      (await catalog.findRepositoryByRemote(adoption.ownerUserId, remote)) ??
      (await catalog.findRepositoryByAlias(adoption.ownerUserId, remote));
    if (existing !== undefined) return { repository: existing, created: false };
  }
  const created = await catalog.createRepository({
    ownerUserId: adoption.ownerUserId,
    displayName: derivedDisplayName(remote, adoption.mainPath),
    canonicalRemote: remote,
  });
  if (created !== undefined) return { repository: created, created: true };
  return {
    repository:
      remote === null
        ? undefined
        : await catalog.findRepositoryByRemote(adoption.ownerUserId, remote),
    created: false,
  };
}

/** One adopted row, or the row a concurrent adopter committed first. */
async function adoptRow(
  catalog: RepositoriesRepository,
  row: {
    readonly ownerUserId: string;
    readonly repositoryId: string;
    readonly executorId: string;
    readonly path: string;
    readonly kind: 'main' | 'worktree';
    readonly parentCheckoutId: string | null;
    readonly branch: string | null;
  },
): Promise<Checkout | undefined> {
  return (
    (await catalog.createCheckout({ ...row, origin: 'adopted' })) ??
    (await catalog.findCheckoutByPath(
      row.ownerUserId,
      row.executorId,
      row.path,
    ))
  );
}
