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
>;

import type { Project } from '../db/schema';

const project: Project = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  name: 'Project',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
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

    return {
      controller: new ProjectsController(service),
      service,
      createProject,
      listProjects,
      getProjectById,
      updateProject,
      deleteProject,
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
        archived: true,
      }),
    ).resolves.toEqual(project);

    expect(getProjectById).toHaveBeenCalledWith(project.id, 'verified-user');
    expect(updateProject).toHaveBeenCalledWith(project.id, 'verified-user', {
      name: 'Renamed',
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
});
