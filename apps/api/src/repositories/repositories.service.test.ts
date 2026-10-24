import { HttpException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Repository } from '../db/schema';
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
  return { service: new RepositoriesService(tenantDb) };
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
