import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';
import { ProjectsService } from './projects.service';

const project = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  name: 'Project',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
};

describe('ProjectsService', () => {
  function makeService() {
    const db: Db = drizzle.mock({ schema });
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    const runAsSpy = vi
      .spyOn(tenantDb, 'runAs')
      .mockImplementation(
        async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
          callback(db),
      );
    return { service: new ProjectsService(tenantDb), runAsSpy };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates through an owner-scoped repository call', async () => {
    const { service, runAsSpy } = makeService();
    const create = vi
      .spyOn(ProjectsRepository.prototype, 'create')
      .mockResolvedValue(project);

    await expect(
      service.createProject('verified-user', { name: 'Project' }),
    ).resolves.toBe(project);

    expect(runAsSpy).toHaveBeenCalledWith(
      'verified-user',
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith({
      ownerUserId: 'verified-user',
      name: 'Project',
    });
  });

  it('forwards list filters and the owner to the repository', async () => {
    const { service, runAsSpy } = makeService();
    const listForUser = vi
      .spyOn(ProjectsRepository.prototype, 'listForUser')
      .mockResolvedValue([project]);
    const filter = { archived: 'with' as const, pinned: 'only' as const };

    await expect(
      service.listProjects('verified-user', filter),
    ).resolves.toEqual([project]);

    expect(listForUser).toHaveBeenCalledWith('verified-user', filter);
    expect(runAsSpy).toHaveBeenCalledWith(
      'verified-user',
      expect.any(Function),
    );
  });

  it('uses the owner scope for reads, updates, and deletes', async () => {
    const { service, runAsSpy } = makeService();
    const findById = vi
      .spyOn(ProjectsRepository.prototype, 'findById')
      .mockResolvedValue(project);
    const update = vi
      .spyOn(ProjectsRepository.prototype, 'update')
      .mockResolvedValue(project);
    const remove = vi
      .spyOn(ProjectsRepository.prototype, 'delete')
      .mockResolvedValue(true);

    await expect(
      service.getProjectById(project.id, project.ownerUserId),
    ).resolves.toBe(project);
    await expect(
      service.updateProject(project.id, project.ownerUserId, {
        name: 'Renamed',
      }),
    ).resolves.toBe(project);
    await expect(
      service.deleteProject(project.id, project.ownerUserId),
    ).resolves.toBe(true);

    expect(findById).toHaveBeenCalledWith(project.id, project.ownerUserId);
    expect(update).toHaveBeenCalledWith(project.id, project.ownerUserId, {
      name: 'Renamed',
    });
    expect(remove).toHaveBeenCalledWith(project.id, project.ownerUserId);
    expect(runAsSpy.mock.calls).toEqual([
      [project.ownerUserId, expect.any(Function)],
      [project.ownerUserId, expect.any(Function)],
      [project.ownerUserId, expect.any(Function)],
    ]);
  });

  it('defaults a missing list filter to an empty object', async () => {
    const { service } = makeService();
    const listForUser = vi
      .spyOn(ProjectsRepository.prototype, 'listForUser')
      .mockResolvedValue([]);

    await expect(service.listProjects('verified-user')).resolves.toEqual([]);

    expect(listForUser).toHaveBeenCalledWith('verified-user', {});
  });
});
