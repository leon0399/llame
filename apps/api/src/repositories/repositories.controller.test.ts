import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Repository } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { notFound } from './failure';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

const repository: Repository = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'owner-a',
  displayName: 'llame',
  canonicalRemote: 'github.com/leon0399/llame',
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

// The controller is a mapping layer: it forwards the verified session's user
// plus the route id, and never a body field that names an owner. The delete
// route has no body at all, so the only thing to prove is that the awaited
// service call happens with exactly that pair.
function makeController() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const service = new RepositoriesService(tenantDb);
  const deleteRepository = vi
    .spyOn(service, 'deleteRepository')
    .mockResolvedValue(undefined);
  return {
    controller: new RepositoriesController(service),
    deleteRepository,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RepositoriesController', () => {
  it('deletes an owned repository and answers no body', async () => {
    const { controller, deleteRepository } = makeController();

    await expect(
      controller.deleteRepository('owner-a', repository.id),
    ).resolves.toBeUndefined();

    expect(deleteRepository).toHaveBeenCalledWith('owner-a', repository.id);
  });

  it('lets the service failure answer the delete', async () => {
    const { controller, deleteRepository } = makeController();
    const failure = notFound();
    deleteRepository.mockRejectedValue(failure);

    await expect(
      controller.deleteRepository('owner-a', repository.id),
    ).rejects.toBe(failure);
  });
});
