import { HttpException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Repository, type RepositoryAlias } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { RepositoriesService } from './repositories.service';
import { RepositoriesRepository } from './repositories.repository';

const repository: Repository = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'owner-a',
  displayName: 'llame',
  canonicalRemote: 'github.com/leon0399/llame',
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

const alias: RepositoryAlias = {
  id: '4a3a3da0-2f2b-4a0e-9a3e-1e0b6e0d2b0c',
  ownerUserId: 'owner-a',
  repositoryId: repository.id,
  canonicalAlias: 'github.com/leon0399/llame-old',
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
};

function makeService() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  return { service: new RepositoriesService(tenantDb), db };
}

/** The typed body an HttpException answers with. */
async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error.getResponse();
    throw error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RepositoriesService', () => {
  it('creates a repository with the normalized remote of its origin', async () => {
    const { service } = makeService();
    const findRepositoryByRemote = vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByRemote')
      .mockResolvedValue(undefined);
    const createRepository = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository);

    await expect(
      service.createRepository('owner-a', {
        displayName: 'llame',
        remote: 'git@github.com:leon0399/llame.git',
      }),
    ).resolves.toBe(repository);

    expect(findRepositoryByRemote).toHaveBeenCalledWith(
      'owner-a',
      'github.com/leon0399/llame',
    );
    expect(createRepository).toHaveBeenCalledWith({
      ownerUserId: 'owner-a',
      displayName: 'llame',
      canonicalRemote: 'github.com/leon0399/llame',
    });
  });

  it('creates a remote-less repository from a display name alone', async () => {
    const { service } = makeService();
    const createRepository = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue({ ...repository, canonicalRemote: null });

    await service.createRepository('owner-a', { displayName: 'llame' });

    expect(createRepository).toHaveBeenCalledWith({
      ownerUserId: 'owner-a',
      displayName: 'llame',
      canonicalRemote: null,
    });
  });

  it('answers a duplicate normalized remote as a conflict', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepositoryByRemote',
    ).mockResolvedValue(repository);

    await expect(
      failureOf(
        service.createRepository('owner-a', {
          displayName: 'llame',
          remote: 'https://github.com/leon0399/llame',
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 409, code: 'remote_taken' });
  });

  it('refuses a display name that leaves its segment with 422', async () => {
    const { service } = makeService();
    const createRepository = vi.spyOn(
      RepositoriesRepository.prototype,
      'createRepository',
    );

    await expect(
      failureOf(
        service.createRepository('owner-a', { displayName: 'team/llame' }),
      ),
    ).resolves.toMatchObject({
      statusCode: 422,
      code: 'invalid_display_name',
    });
    expect(createRepository).not.toHaveBeenCalled();
  });

  it('declares an alias with the normalized alias text', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repository);
    const declareAlias = vi
      .spyOn(RepositoriesRepository.prototype, 'declareAlias')
      .mockResolvedValue(alias);

    await expect(
      service.declareAlias(
        'owner-a',
        repository.id,
        'https://github.com/leon0399/llame-old.git',
      ),
    ).resolves.toBe(alias);

    expect(declareAlias).toHaveBeenCalledWith({
      ownerUserId: 'owner-a',
      repositoryId: repository.id,
      canonicalAlias: 'github.com/leon0399/llame-old',
    });
  });

  it('answers a duplicate alias as a conflict', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repository);
    vi.spyOn(
      RepositoriesRepository.prototype,
      'declareAlias',
    ).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    await expect(
      failureOf(
        service.declareAlias('owner-a', repository.id, 'github.com/o/r'),
      ),
    ).resolves.toMatchObject({ statusCode: 409, code: 'alias_taken' });
  });

  it('answers 404 for an alias on a repository this owner does not hold', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(undefined);

    await expect(
      failureOf(
        service.declareAlias('owner-a', repository.id, 'github.com/o/r'),
      ),
    ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('deletes a repository and answers 404 when nothing was removed', async () => {
    const { service } = makeService();
    const deleteRepository = vi
      .spyOn(RepositoriesRepository.prototype, 'deleteRepository')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      service.deleteRepository('owner-a', repository.id),
    ).resolves.toBeUndefined();
    await expect(
      failureOf(service.deleteRepository('owner-a', repository.id)),
    ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(deleteRepository).toHaveBeenCalledTimes(2);
  });

  it('refuses a PATCH that would take another repository’s remote', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepositoryByRemote',
    ).mockResolvedValue({ ...repository, id: 'other-repository' });

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          remote: 'https://github.com/leon0399/llame',
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 409, code: 'remote_taken' });
  });
});
