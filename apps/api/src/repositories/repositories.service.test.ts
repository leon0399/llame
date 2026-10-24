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

function makeService() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  // The catalog read is the alias seam: each case states what the owner holds,
  // so a case that forgets to state it sees an owner that holds nothing.
  vi.spyOn(
    RepositoriesRepository.prototype,
    'findRepository',
  ).mockResolvedValue(undefined);
  // The claim namespace spans both tables, so every case starts with: no alias
  // declares the remote, no canonical remote claims it, and the lock never
  // blocks.
  const findRepositoryByAlias = vi
    .spyOn(RepositoriesRepository.prototype, 'findRepositoryByAlias')
    .mockResolvedValue(undefined);
  const findRepositoryByRemote = vi
    .spyOn(RepositoriesRepository.prototype, 'findRepositoryByRemote')
    .mockResolvedValue(undefined);
  const lockRemoteClaim = vi
    .spyOn(RepositoriesRepository.prototype, 'lockRemoteClaim')
    .mockResolvedValue(undefined);
  return {
    service: new RepositoriesService(tenantDb),
    findRepositoryByAlias,
    findRepositoryByRemote,
    lockRemoteClaim,
  };
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

/**
 * The app-layer half of isolation and of the PATCH race. Creation, naming, and
 * alias rules run against real Postgres in `repositories.integration.test.ts`
 * (testing.md rule 7).
 */
describe('RepositoriesService', () => {
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

  it('answers 404 when a delete removed nothing', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'deleteRepository',
    ).mockResolvedValue(false);

    await expect(
      failureOf(service.deleteRepository('owner-a', repository.id)),
    ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('maps a remote claimed between the read and the write to 409', async () => {
    const { service } = makeService();
    // The unique key is the only guard the update has: a concurrent claim of
    // the same remote surfaces as its violation, not as a 500.
    vi.spyOn(
      RepositoriesRepository.prototype,
      'updateRepository',
    ).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          remote: 'https://github.com/leon0399/llame',
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 409, code: 'remote_taken' });
  });
});

const alias: RepositoryAlias = {
  id: '6f9e3c1f-6a55-4a8c-9c2b-3a3f4c2b9e11',
  ownerUserId: 'owner-a',
  repositoryId: repository.id,
  canonicalAlias: 'github.com/leon0399/other',
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
};

describe('createRepository', () => {
  it('stores the canonical remote of the submitted form', async () => {
    const { service } = makeService();
    const create = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository);

    await expect(
      service.createRepository('owner-a', {
        displayName: 'llame',
        remote: 'https://GitHub.com/leon0399/llame.git',
      }),
    ).resolves.toBe(repository);

    expect(create).toHaveBeenCalledWith({
      ownerUserId: 'owner-a',
      displayName: 'llame',
      canonicalRemote: 'github.com/leon0399/llame',
    });
  });

  it('locks the remote claim before it reads or writes', async () => {
    const { service, findRepositoryByAlias, lockRemoteClaim } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'createRepository',
    ).mockResolvedValue(repository);

    await service.createRepository('owner-a', {
      displayName: 'llame',
      remote: 'https://github.com/leon0399/llame',
    });

    // A canonical remote and an alias are unique in their own table, so the
    // check across both needs one lock to be atomic.
    expect(lockRemoteClaim).toHaveBeenCalledWith(
      'owner-a',
      'github.com/leon0399/llame',
    );
    expect(findRepositoryByAlias).toHaveBeenCalledWith(
      'owner-a',
      'github.com/leon0399/llame',
    );
  });

  it('answers 409 alias_taken when an alias already names the remote', async () => {
    const { service, findRepositoryByAlias } = makeService();
    const create = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository);
    findRepositoryByAlias.mockResolvedValue(repository);

    await expect(
      failureOf(
        service.createRepository('owner-a', {
          displayName: 'llame',
          remote: 'https://github.com/leon0399/other',
        }),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'That remote is already an alias of this owner.',
      code: 'alias_taken',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('stores no remote for an absent or a blank remote', async () => {
    const { service, findRepositoryByAlias, lockRemoteClaim } = makeService();
    const create = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository);

    await service.createRepository('owner-a', { displayName: 'llame' });
    await service.createRepository('owner-a', {
      displayName: 'llame',
      remote: '   ',
    });

    expect(
      create.mock.calls.map(([input]) => input.canonicalRemote),
    ).toStrictEqual([null, null]);
    // A repository without a remote claims no name, so the lock is taken but
    // no alias can conflict with it.
    expect(lockRemoteClaim.mock.calls).toStrictEqual([
      ['owner-a', null],
      ['owner-a', null],
    ]);
    expect(findRepositoryByAlias).not.toHaveBeenCalled();
  });

  it.each([
    ['   ', 'must not be blank'],
    ['.', 'must not be "." or ".."'],
    ['..', 'must not be "." or ".."'],
    ['team/llame', 'must not contain "/" or a NUL byte'],
    ['team\0llame', 'must not contain "/" or a NUL byte'],
    ['x'.repeat(201), 'must be at most 200 characters'],
  ])('refuses the display name %j with 422', async (displayName, problem) => {
    const { service } = makeService();
    const create = vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository);

    await expect(
      failureOf(service.createRepository('owner-a', { displayName })),
    ).resolves.toStrictEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: `displayName ${problem}; it is one path segment of at most 200 characters.`,
      code: 'invalid_display_name',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 409 remote_taken when the insert found the remote taken', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'createRepository',
    ).mockResolvedValue(undefined);

    await expect(
      failureOf(
        service.createRepository('owner-a', {
          displayName: 'llame',
          remote: 'https://github.com/leon0399/llame',
        }),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message:
        "The remote github.com/leon0399/llame is already one of this owner's repositories.",
      code: 'remote_taken',
    });
  });

  it('names the empty remote in a conflict over a remote-less repository', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'createRepository',
    ).mockResolvedValue(undefined);

    await expect(
      failureOf(service.createRepository('owner-a', { displayName: 'llame' })),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message: "The remote  is already one of this owner's repositories.",
      code: 'remote_taken',
    });
  });
});

describe('updateRepository', () => {
  it('sends only the display name when the patch carries only one', async () => {
    const { service } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await expect(
      service.updateRepository('owner-a', repository.id, {
        displayName: 'renamed',
      }),
    ).resolves.toBe(repository);

    const [, , patch] = update.mock.calls[0];
    expect(patch).toStrictEqual({ displayName: 'renamed' });
  });

  it('sends only the canonical remote when the patch carries only one', async () => {
    const { service } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await service.updateRepository('owner-a', repository.id, {
      remote: 'https://github.com/leon0399/other.git',
    });

    const [, , patch] = update.mock.calls[0];
    expect(patch).toStrictEqual({
      canonicalRemote: 'github.com/leon0399/other',
    });
  });

  it('sends both keys of a full patch, clearing a null remote', async () => {
    const { service } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await service.updateRepository('owner-a', repository.id, {
      displayName: 'renamed',
      remote: null,
    });

    const [, , patch] = update.mock.calls[0];
    expect(patch).toStrictEqual({
      displayName: 'renamed',
      canonicalRemote: null,
    });
  });

  it('sends an empty patch when the patch carries nothing', async () => {
    const { service } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await service.updateRepository('owner-a', repository.id, {});

    const [, , patch] = update.mock.calls[0];
    expect(patch).toStrictEqual({});
  });

  it('answers 409 alias_taken when the new remote is an alias already', async () => {
    const { service, findRepositoryByAlias } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);
    findRepositoryByAlias.mockResolvedValue(repository);

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          remote: 'https://github.com/leon0399/other.git',
        }),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'That remote is already an alias of this owner.',
      code: 'alias_taken',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('clears a remote without reading the alias table', async () => {
    const { service, findRepositoryByAlias, lockRemoteClaim } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await service.updateRepository('owner-a', repository.id, { remote: null });

    // Clearing the remote claims no name, so no alias can be shadowed by it.
    expect(lockRemoteClaim).toHaveBeenCalledWith('owner-a', null);
    expect(findRepositoryByAlias).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('validates a patched display name before any write', async () => {
    const { service } = makeService();
    const update = vi
      .spyOn(RepositoriesRepository.prototype, 'updateRepository')
      .mockResolvedValue(repository);

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          displayName: '..',
        }),
      ),
    ).resolves.toMatchObject({
      statusCode: 422,
      code: 'invalid_display_name',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('names the normalized remote on a unique violation', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'updateRepository',
    ).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          remote: 'https://github.com/leon0399/llame',
        }),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message:
        "The remote github.com/leon0399/llame is already one of this owner's repositories.",
      code: 'remote_taken',
    });
  });

  it('names no remote when a display-name-only patch hits the unique key', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'updateRepository',
    ).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          displayName: 'renamed',
        }),
      ),
    ).resolves.toMatchObject({
      statusCode: 409,
      message: "The remote  is already one of this owner's repositories.",
    });
  });

  it('rethrows a failure that is not a unique violation', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'updateRepository',
    ).mockRejectedValue(new Error('connection reset'));

    await expect(
      service.updateRepository('owner-a', repository.id, {
        displayName: 'renamed',
      }),
    ).rejects.toThrow('connection reset');
  });

  it('answers 404 when the update matched no row', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'updateRepository',
    ).mockResolvedValue(undefined);

    await expect(
      failureOf(
        service.updateRepository('owner-a', repository.id, {
          displayName: 'renamed',
        }),
      ),
    ).resolves.toStrictEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
  });
});

describe('deleteRepository', () => {
  it('removes the repository the owner holds', async () => {
    const { service } = makeService();
    const remove = vi
      .spyOn(RepositoriesRepository.prototype, 'deleteRepository')
      .mockResolvedValue(true);

    await expect(
      service.deleteRepository('owner-a', repository.id),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith('owner-a', repository.id);
  });
});

describe('declareAlias', () => {
  it('stores the canonical alias of the submitted remote', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repository);
    const declare = vi
      .spyOn(RepositoriesRepository.prototype, 'declareAlias')
      .mockResolvedValue(alias);

    await expect(
      service.declareAlias(
        'owner-a',
        repository.id,
        'https://github.com/leon0399/other.git',
      ),
    ).resolves.toBe(alias);

    expect(declare).toHaveBeenCalledWith({
      ownerUserId: 'owner-a',
      repositoryId: repository.id,
      canonicalAlias: 'github.com/leon0399/other',
    });
  });

  it('answers 409 remote_taken when the alias names a canonical remote', async () => {
    const { service, findRepositoryByRemote } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repository);
    const declare = vi
      .spyOn(RepositoriesRepository.prototype, 'declareAlias')
      .mockResolvedValue(alias);
    findRepositoryByRemote.mockResolvedValue(repository);

    // The canonical remote already selects its repository, so an alias of it
    // would never be consulted.
    await expect(
      failureOf(
        service.declareAlias(
          'owner-a',
          repository.id,
          'https://github.com/leon0399/llame',
        ),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message:
        "The remote github.com/leon0399/llame is already one of this owner's repositories.",
      code: 'remote_taken',
    });
    expect(declare).not.toHaveBeenCalled();
  });

  it.each(['', '   '])(
    'refuses the blank alias %j with 422',
    async (remote) => {
      const { service } = makeService();
      const declare = vi
        .spyOn(RepositoriesRepository.prototype, 'declareAlias')
        .mockResolvedValue(alias);

      await expect(
        failureOf(service.declareAlias('owner-a', repository.id, remote)),
      ).resolves.toStrictEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'A repository alias must be a remote.',
        code: 'invalid_remote',
      });
      expect(declare).not.toHaveBeenCalled();
    },
  );

  it('answers 409 alias_taken when the owner already declared it', async () => {
    const { service } = makeService();
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repository);
    vi.spyOn(
      RepositoriesRepository.prototype,
      'declareAlias',
    ).mockResolvedValue(undefined);

    await expect(
      failureOf(
        service.declareAlias('owner-a', repository.id, 'github.com/o/other'),
      ),
    ).resolves.toStrictEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'That remote is already an alias of this owner.',
      code: 'alias_taken',
    });
  });
});
