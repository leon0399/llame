import { Injectable } from '@nestjs/common';

import { pgErrorCode } from '../db/pg-error';
import { type Repository, type RepositoryAlias } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { DISPLAY_NAME_MAX, displayNameProblem } from './display-name';
import { notFound, repositoryFailure } from './failure';
import { normalizeRemote } from './remote';
import { RepositoriesRepository } from './repositories.repository';

/**
 * The owner's catalog: repositories, their aliases, and nothing that runs git.
 * A repository is created here with a display name and an optional remote; a
 * checkout registration fills it in from the inspected `origin` instead
 * (`CheckoutRegistrationService`).
 */
@Injectable()
export class RepositoriesService {
  constructor(private readonly tenantDb: TenantDbService) {}

  listRepositories(ownerUserId: string): Promise<Array<Repository>> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).listRepositories(ownerUserId),
    );
  }

  async createRepository(
    ownerUserId: string,
    input: { readonly displayName: string; readonly remote?: string | null },
  ): Promise<Repository> {
    const problem = displayNameProblem(input.displayName);
    if (problem !== null) throw invalidDisplayName(problem);
    const canonicalRemote = normalizeRemote(input.remote ?? '') || null;
    const created = await this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      await this.claimRemote(repository, ownerUserId, canonicalRemote);
      return repository.createRepository({
        ownerUserId,
        displayName: input.displayName,
        canonicalRemote,
      });
    });
    // The unique key decides, so a concurrent claim of the same remote lands
    // here as the same conflict as a sequential one.
    if (created === undefined) throw remoteTaken(canonicalRemote);
    return created;
  }

  /**
   * Take the owner's claim on one canonical remote and refuse it when an alias
   * already names it. A remote names one repository of an owner: an alias is
   * such a name, so storing this remote here while an alias holds it would
   * leave two rows for one remote, and every reader resolves a canonical remote
   * before an alias. The lock covers the read, because the two tables have
   * separate unique keys.
   */
  private async claimRemote(
    repository: RepositoriesRepository,
    ownerUserId: string,
    canonicalRemote: string | null | undefined,
  ): Promise<void> {
    // An omitted remote is not part of the patch at all: nothing to claim.
    if (canonicalRemote === undefined) return;
    await repository.lockRemoteClaim(ownerUserId, canonicalRemote);
    if (canonicalRemote === null) return;
    if (
      (await repository.findRepositoryByAlias(ownerUserId, canonicalRemote)) !==
      undefined
    ) {
      throw aliasTaken();
    }
  }

  async updateRepository(
    ownerUserId: string,
    repositoryId: string,
    patch: { readonly displayName?: string; readonly remote?: string | null },
  ): Promise<Repository> {
    if (patch.displayName !== undefined) {
      const problem = displayNameProblem(patch.displayName);
      if (problem !== null) throw invalidDisplayName(problem);
    }
    const canonicalRemote =
      patch.remote === undefined
        ? undefined
        : normalizeRemote(patch.remote ?? '') || null;
    let updated: Repository | undefined;
    try {
      updated = await this.tenantDb.runAs(ownerUserId, async (tx) => {
        const repository = new RepositoriesRepository(tx);
        await this.claimRemote(repository, ownerUserId, canonicalRemote);
        return repository.updateRepository(ownerUserId, repositoryId, {
          ...(patch.displayName !== undefined && {
            displayName: patch.displayName,
          }),
          ...(canonicalRemote !== undefined && { canonicalRemote }),
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505')
        throw remoteTaken(canonicalRemote ?? null);
      throw error;
    }
    if (updated === undefined) throw notFound();
    return updated;
  }

  async deleteRepository(
    ownerUserId: string,
    repositoryId: string,
  ): Promise<void> {
    const deleted = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).deleteRepository(
        ownerUserId,
        repositoryId,
      ),
    );
    if (!deleted) throw notFound();
  }

  async declareAlias(
    ownerUserId: string,
    repositoryId: string,
    remote: string,
  ): Promise<RepositoryAlias> {
    const canonicalAlias = normalizeRemote(remote);
    if (canonicalAlias === '') {
      throw repositoryFailure(
        'invalid_remote',
        'A repository alias must be a remote.',
      );
    }
    const alias = await this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      await repository.lockRemoteClaim(ownerUserId, canonicalAlias);
      if (
        (await repository.findRepository(ownerUserId, repositoryId)) ===
        undefined
      ) {
        throw notFound();
      }
      // A canonical remote already names its repository, so no alias may name
      // that remote: the readers resolve a canonical remote first, and the
      // declared alias would select nothing.
      if (
        (await repository.findRepositoryByRemote(
          ownerUserId,
          canonicalAlias,
        )) !== undefined
      ) {
        throw remoteTaken(canonicalAlias);
      }
      return repository.declareAlias({
        ownerUserId,
        repositoryId,
        canonicalAlias,
      });
    });
    if (alias === undefined) throw aliasTaken();
    return alias;
  }
}

function invalidDisplayName(problem: string) {
  return repositoryFailure(
    'invalid_display_name',
    `displayName ${problem}; it is one path segment of at most ${DISPLAY_NAME_MAX} characters.`,
  );
}

function remoteTaken(canonicalRemote: string | null) {
  return repositoryFailure(
    'remote_taken',
    `The remote ${canonicalRemote ?? ''} is already one of this owner's repositories.`,
  );
}

function aliasTaken() {
  return repositoryFailure(
    'alias_taken',
    'That remote is already an alias of this owner.',
  );
}
