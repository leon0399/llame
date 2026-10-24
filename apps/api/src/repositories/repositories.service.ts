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
    requireValidDisplayName(input.displayName);
    const canonicalRemote = normalizeRemote(input.remote ?? '') || null;
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      if (canonicalRemote !== null) {
        await requireRemoteFree(repository, ownerUserId, canonicalRemote);
      }
      try {
        return await repository.createRepository({
          ownerUserId,
          displayName: input.displayName,
          canonicalRemote,
        });
      } catch (error) {
        if (pgErrorCode(error) === '23505') throw remoteTaken(canonicalRemote);
        throw error;
      }
    });
  }

  async updateRepository(
    ownerUserId: string,
    repositoryId: string,
    patch: { readonly displayName?: string; readonly remote?: string | null },
  ): Promise<Repository> {
    if (patch.displayName !== undefined) {
      requireValidDisplayName(patch.displayName);
    }
    const canonicalRemote =
      patch.remote === undefined
        ? undefined
        : normalizeRemote(patch.remote ?? '') || null;
    if (canonicalRemote !== null && canonicalRemote !== undefined) {
      await this.requireRemoteFreeFor(
        ownerUserId,
        repositoryId,
        canonicalRemote,
      );
    }
    const updated = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).updateRepository(
        ownerUserId,
        repositoryId,
        {
          ...(patch.displayName !== undefined && {
            displayName: patch.displayName,
          }),
          ...(canonicalRemote !== undefined && { canonicalRemote }),
        },
      ),
    );
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
        'unprocessable',
        'invalid_remote',
        'A repository alias must be a remote.',
      );
    }
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      if (
        (await repository.findRepository(ownerUserId, repositoryId)) ===
        undefined
      ) {
        throw notFound();
      }
      try {
        return await repository.declareAlias({
          ownerUserId,
          repositoryId,
          canonicalAlias,
        });
      } catch (error) {
        if (pgErrorCode(error) === '23505') {
          throw repositoryFailure(
            'conflict',
            'alias_taken',
            'That remote is already an alias of this owner.',
          );
        }
        throw error;
      }
    });
  }

  private async requireRemoteFreeFor(
    ownerUserId: string,
    repositoryId: string,
    canonicalRemote: string,
  ): Promise<void> {
    const held = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).findRepositoryByRemote(
        ownerUserId,
        canonicalRemote,
      ),
    );
    if (held !== undefined && held.id !== repositoryId) {
      throw remoteTaken(canonicalRemote);
    }
  }
}

function requireValidDisplayName(name: string): void {
  const problem = displayNameProblem(name);
  if (problem !== null) {
    throw repositoryFailure(
      'unprocessable',
      'invalid_display_name',
      `displayName ${problem}; it is one path segment of at most ${DISPLAY_NAME_MAX} characters.`,
    );
  }
}

async function requireRemoteFree(
  repository: RepositoriesRepository,
  ownerUserId: string,
  canonicalRemote: string,
): Promise<void> {
  if (
    (await repository.findRepositoryByRemote(ownerUserId, canonicalRemote)) !==
    undefined
  ) {
    throw remoteTaken(canonicalRemote);
  }
}

function remoteTaken(canonicalRemote: string | null) {
  return repositoryFailure(
    'conflict',
    'remote_taken',
    `The remote ${canonicalRemote ?? ''} is already one of this owner's repositories.`,
  );
}
