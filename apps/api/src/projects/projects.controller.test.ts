import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

type ProjectServiceMethods = Pick<
  ProjectsService,
  | 'createProject'
  | 'listProjects'
  | 'getProjectById'
  | 'updateProject'
  | 'deleteProject'
  | 'listProjectRepositories'
  | 'linkRepository'
  | 'updateProjectRepository'
  | 'unlinkRepository'
  | 'getStartLocation'
>;

import type {
  Project,
  ProjectRepository,
  ProjectRepositoryDefault,
} from '../db/schema';

const link: ProjectRepository = {
  id: '44444444-4444-4444-8444-444444444444',
  ownerUserId: 'verified-user',
  projectId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  alias: 'llame',
  isPrimary: false,
  isolation: 'inherit',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

const linkDefault: ProjectRepositoryDefault = {
  id: '66666666-6666-4666-8666-666666666666',
  ownerUserId: 'verified-user',
  projectRepositoryId: link.id,
  executorId: 'host',
  checkoutId: '55555555-5555-4555-8555-555555555555',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

const project: Project = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  name: 'Project',
  description: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
  defaultExecutorId: null,
};

describe('ProjectsController', () => {
  function makeController(overrides: Partial<ProjectServiceMethods> = {}) {
    const db: Db = drizzle.mock({ schema });
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    const service = new ProjectsService(tenantDb);
    const createProject = vi
      .spyOn(service, 'createProject')
      .mockResolvedValue(project);
    const listProjects = vi
      .spyOn(service, 'listProjects')
      .mockResolvedValue([project]);
    const getProjectById = vi
      .spyOn(service, 'getProjectById')
      .mockResolvedValue(project);
    const updateProject = vi
      .spyOn(service, 'updateProject')
      .mockResolvedValue(project);
    const deleteProject = vi
      .spyOn(service, 'deleteProject')
      .mockResolvedValue(true);
    const listProjectRepositories = vi
      .spyOn(service, 'listProjectRepositories')
      .mockResolvedValue([{ link, defaults: [linkDefault] }]);
    const linkRepository = vi
      .spyOn(service, 'linkRepository')
      .mockResolvedValue(link);
    const updateProjectRepository = vi
      .spyOn(service, 'updateProjectRepository')
      .mockResolvedValue(link);
    const unlinkRepository = vi
      .spyOn(service, 'unlinkRepository')
      .mockResolvedValue(undefined);
    const getStartLocation = vi
      .spyOn(service, 'getStartLocation')
      .mockResolvedValue({
        repositoryId: link.repositoryId,
        executorId: 'host',
        checkoutId: linkDefault.checkoutId,
        isolation: 'reuse',
        isolationReason: 'project_policy',
        isolationChats: 0,
      });

    if (overrides.createProject !== undefined) {
      createProject.mockImplementation(overrides.createProject);
    }
    if (overrides.listProjects !== undefined) {
      listProjects.mockImplementation(overrides.listProjects);
    }
    if (overrides.getProjectById !== undefined) {
      getProjectById.mockImplementation(overrides.getProjectById);
    }
    if (overrides.updateProject !== undefined) {
      updateProject.mockImplementation(overrides.updateProject);
    }
    if (overrides.deleteProject !== undefined) {
      deleteProject.mockImplementation(overrides.deleteProject);
    }
    if (overrides.listProjectRepositories !== undefined) {
      listProjectRepositories.mockImplementation(
        overrides.listProjectRepositories,
      );
    }
    if (overrides.linkRepository !== undefined) {
      linkRepository.mockImplementation(overrides.linkRepository);
    }
    if (overrides.updateProjectRepository !== undefined) {
      updateProjectRepository.mockImplementation(
        overrides.updateProjectRepository,
      );
    }
    if (overrides.unlinkRepository !== undefined) {
      unlinkRepository.mockImplementation(overrides.unlinkRepository);
    }
    if (overrides.getStartLocation !== undefined) {
      getStartLocation.mockImplementation(overrides.getStartLocation);
    }

    return {
      controller: new ProjectsController(service),
      service,
      createProject,
      listProjects,
      getProjectById,
      updateProject,
      deleteProject,
      listProjectRepositories,
      linkRepository,
      updateProjectRepository,
      unlinkRepository,
      getStartLocation,
    };
  }

  it('creates with the verified user and maps the response', async () => {
    const { controller, createProject } = makeController();

    await expect(
      controller.createProject('verified-user', { name: 'Project' }),
    ).resolves.toEqual(project);

    expect(createProject).toHaveBeenCalledWith('verified-user', {
      name: 'Project',
    });
  });

  it('lists with the verified user and maps every project', async () => {
    const second = { ...project, id: '1b6f5499-dde4-43cf-89fe-037998a0fe64' };
    const { controller, listProjects } = makeController({
      listProjects: () => Promise.resolve([project, second]),
    });

    await expect(
      controller.getProjects('verified-user', { archived: 'with' }),
    ).resolves.toEqual([project, second]);

    expect(listProjects).toHaveBeenCalledWith('verified-user', {
      archived: 'with',
    });
  });

  it('returns a project by id and forwards update fields', async () => {
    const { controller, getProjectById, updateProject } = makeController();

    await expect(
      controller.getProjectById('verified-user', project.id),
    ).resolves.toEqual(project);
    await expect(
      controller.updateProject('verified-user', project.id, {
        name: 'Renamed',
        description: 'Acme relaunch',
        archived: true,
      }),
    ).resolves.toEqual(project);

    expect(getProjectById).toHaveBeenCalledWith(project.id, 'verified-user');
    expect(updateProject).toHaveBeenCalledWith(project.id, 'verified-user', {
      name: 'Renamed',
      description: 'Acme relaunch',
      archived: true,
    });
  });

  it('maps missing reads and deletes to not-found errors', async () => {
    const { controller } = makeController({
      getProjectById: () => Promise.resolve(undefined),
      updateProject: () => Promise.resolve(undefined),
      deleteProject: () => Promise.resolve(false),
    });

    await expect(
      controller.getProjectById('verified-user', project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.updateProject('verified-user', project.id, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.deleteProject('verified-user', project.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an owned project without returning a body', async () => {
    const { controller, deleteProject } = makeController();

    await expect(
      controller.deleteProject('verified-user', project.id),
    ).resolves.toBeUndefined();
    expect(deleteProject).toHaveBeenCalledWith(project.id, 'verified-user');
  });

  it('maps every link with its own defaults', async () => {
    const { controller, listProjectRepositories } = makeController();

    await expect(
      controller.listProjectRepositories('verified-user', project.id),
    ).resolves.toEqual([
      {
        id: link.id,
        ownerUserId: link.ownerUserId,
        projectId: link.projectId,
        repositoryId: link.repositoryId,
        alias: link.alias,
        isPrimary: link.isPrimary,
        isolation: link.isolation,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        defaults: [
          {
            id: linkDefault.id,
            projectRepositoryId: link.id,
            executorId: linkDefault.executorId,
            checkoutId: linkDefault.checkoutId,
            updatedAt: linkDefault.updatedAt,
          },
        ],
      },
    ]);
    expect(listProjectRepositories).toHaveBeenCalledWith(
      'verified-user',
      project.id,
    );
  });

  it('links, updates, and unlinks a repository under the project', async () => {
    const {
      controller,
      linkRepository,
      updateProjectRepository,
      unlinkRepository,
    } = makeController();

    await expect(
      controller.linkProjectRepository('verified-user', project.id, {
        repositoryId: link.repositoryId,
      }),
    ).resolves.toMatchObject({ id: link.id, repositoryId: link.repositoryId });
    await expect(
      controller.updateProjectRepositoryLink(
        'verified-user',
        project.id,
        link.repositoryId,
        { isPrimary: true },
      ),
    ).resolves.toMatchObject({ isPrimary: link.isPrimary });
    await expect(
      controller.unlinkProjectRepository(
        'verified-user',
        project.id,
        link.repositoryId,
      ),
    ).resolves.toBeUndefined();

    expect(linkRepository).toHaveBeenCalledWith('verified-user', project.id, {
      repositoryId: link.repositoryId,
    });
    expect(updateProjectRepository).toHaveBeenCalledWith(
      'verified-user',
      project.id,
      link.repositoryId,
      { isPrimary: true },
    );
    expect(unlinkRepository).toHaveBeenCalledWith(
      'verified-user',
      project.id,
      link.repositoryId,
    );
  });

  it('returns the start location with the project id', async () => {
    const { controller, getStartLocation } = makeController();

    await expect(
      controller.getProjectStartLocation('verified-user', project.id, {
        executorId: 'host',
      }),
    ).resolves.toEqual({
      projectId: project.id,
      repositoryId: link.repositoryId,
      executorId: 'host',
      checkoutId: linkDefault.checkoutId,
      isolation: 'reuse',
      isolationReason: 'project_policy',
      isolationChats: 0,
    });
    expect(getStartLocation).toHaveBeenCalledWith('verified-user', project.id, {
      executorId: 'host',
    });
  });
});
