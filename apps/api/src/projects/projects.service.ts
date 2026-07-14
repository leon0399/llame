import { Injectable } from '@nestjs/common';
import { type Project } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';

@Injectable()
export class ProjectsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async createProject(
    ownerUserId: string,
    input: { name: string },
  ): Promise<Project> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).create({ ownerUserId, name: input.name }),
    );
  }

  /** Owned projects, newest-updated first; honors the archive/pin list filters. */
  async listProjects(
    ownerUserId: string,
    filter: {
      pinned?: 'only' | 'with' | 'exclude';
      archived?: 'only' | 'with';
    } = {},
  ): Promise<Project[]> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).listForUser(ownerUserId, filter),
    );
  }

  async getProjectById(
    projectId: string,
    ownerUserId: string,
  ): Promise<Project | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).findById(projectId, ownerUserId),
    );
  }

  async updateProject(
    projectId: string,
    ownerUserId: string,
    patch: { name?: string; archived?: boolean },
  ): Promise<Project | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).update(projectId, ownerUserId, patch),
    );
  }

  async deleteProject(
    projectId: string,
    ownerUserId: string,
  ): Promise<boolean> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).delete(projectId, ownerUserId),
    );
  }
}
