import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { assertNotArchived } from '../db/assert-not-archived';
import { pgErrorCode } from '../db/pg-error';
import {
  type Project,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type ProjectRepositoryIsolation,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { defaultTargetProblem } from './default-target';
import {
  ProjectLinksRepository,
  type ProjectLinkWithDefaults,
} from './project-links.repository';
import { ProjectsRepository } from './projects-repository';
import {
  resolveStartLocation,
  type StartLocation,
  type StartLocationInput,
} from './start-location';

@Injectable()
export class ProjectsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async createProject(
    ownerUserId: string,
    input: { name: string; description?: string | null },
  ): Promise<Project> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ProjectsRepository(tx).create({ ownerUserId, ...input }),
    );
  }

  /** Owned projects, newest-updated first; honors the archive/pin list filters. */
  async listProjects(
    ownerUserId: string,
    filter: {
      pinned?: 'only' | 'with' | 'exclude';
      archived?: 'only' | 'with';
    } = {},
  ): Promise<Array<Project>> {
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
    patch: {
      name?: string;
      description?: string | null;
      archived?: boolean;
      defaultExecutorId?: string | null;
    },
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

  /**
   * The project's links and their per-executor defaults. A read, so it admits
   * an archived project; another owner's project is simply absent (404).
   */
  async listProjectRepositories(
    ownerUserId: string,
    projectId: string,
  ): Promise<Array<ProjectLinkWithDefaults>> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const project = await new ProjectsRepository(tx).findById(
        projectId,
        ownerUserId,
      );
      if (project === undefined) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
      const links = new ProjectLinksRepository(tx);
      const rows = await links.listLinks(ownerUserId, project.id);
      const defaults = await links.listDefaults(
        ownerUserId,
        rows.map((row) => row.id),
      );
      return rows.map((link) => ({
        link,
        defaults: defaults.filter((row) => row.projectRepositoryId === link.id),
      }));
    });
  }

  /**
   * Link one of the owner's catalog repositories to the project. A repository
   * that is not the caller's is 404 rather than a distinct refusal, so the
   * route discloses no foreign row; an archived project answers 409.
   */
  async linkRepository(
    ownerUserId: string,
    projectId: string,
    input: ProjectLinkInput,
  ): Promise<ProjectRepository> {
    try {
      return await this.tenantDb.runAs(ownerUserId, (tx) =>
        this.createLink(tx, ownerUserId, projectId, input),
      );
    } catch (error) {
      // A concurrent primary switch can also trip the partial index, which
      // `ON CONFLICT` does not name.
      if (pgErrorCode(error) === '23505') {
        throw new ConflictException(LINK_CONFLICT);
      }
      throw error;
    }
  }

  private async createLink(
    tx: Db,
    ownerUserId: string,
    projectId: string,
    input: ProjectLinkInput,
  ): Promise<ProjectRepository> {
    const project = await new ProjectsRepository(tx).findById(
      projectId,
      ownerUserId,
    );
    if (project === undefined) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    assertNotArchived(project);
    const links = new ProjectLinksRepository(tx);
    const repository = await links.findRepository(
      ownerUserId,
      input.repositoryId,
    );
    if (repository === undefined) {
      throw new NotFoundException(`Repository ${input.repositoryId} not found`);
    }
    // The partial unique index admits one primary per project, so the previous
    // primary is cleared in the same transaction.
    if (input.isPrimary === true) {
      await links.clearPrimary(ownerUserId, project.id);
    }
    const created = await links.createLink({
      ownerUserId,
      projectId: project.id,
      repositoryId: repository.id,
      alias: input.alias ?? repository.displayName,
      isPrimary: input.isPrimary ?? false,
      isolation: input.isolation ?? 'inherit',
    });
    if (created === undefined) throw new ConflictException(LINK_CONFLICT);
    return created;
  }

  async updateProjectRepository(
    ownerUserId: string,
    projectId: string,
    repositoryId: string,
    patch: ProjectLinkPatch,
  ): Promise<ProjectRepository> {
    try {
      const updated = await this.tenantDb.runAs(ownerUserId, (tx) =>
        this.changeLink(tx, ownerUserId, { projectId, repositoryId }, patch),
      );
      if (updated === undefined) {
        throw new NotFoundException(
          `The project does not link repository ${repositoryId}`,
        );
      }
      return updated;
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ConflictException(LINK_CONFLICT);
      }
      throw error;
    }
  }

  private async changeLink(
    tx: Db,
    ownerUserId: string,
    target: { readonly projectId: string; readonly repositoryId: string },
    patch: ProjectLinkPatch,
  ): Promise<ProjectRepository | undefined> {
    const { projectId, repositoryId } = target;
    const project = await new ProjectsRepository(tx).findById(
      projectId,
      ownerUserId,
    );
    if (project === undefined) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    assertNotArchived(project);
    const links = new ProjectLinksRepository(tx);
    const link = await links.findLinkByRepository(
      ownerUserId,
      project.id,
      repositoryId,
    );
    if (link === undefined) {
      throw new NotFoundException(
        `The project does not link repository ${repositoryId}`,
      );
    }
    if (patch.isPrimary === true) {
      await links.clearPrimary(ownerUserId, project.id);
    }
    return links.updateLink(ownerUserId, link.id, patch);
  }

  /** Unlink a repository; the link's defaults cascade, the rows of the
   *  repository and its checkouts stay. */
  async unlinkRepository(
    ownerUserId: string,
    projectId: string,
    repositoryId: string,
  ): Promise<void> {
    await this.tenantDb.runAs(ownerUserId, async (tx) => {
      const project = await new ProjectsRepository(tx).findById(
        projectId,
        ownerUserId,
      );
      if (project === undefined) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
      assertNotArchived(project);
      const links = new ProjectLinksRepository(tx);
      const link = await links.findLinkByRepository(
        ownerUserId,
        project.id,
        repositoryId,
      );
      if (link === undefined) {
        throw new NotFoundException(
          `The project does not link repository ${repositoryId}`,
        );
      }
      await links.deleteLink(ownerUserId, project.id, link.id);
    });
  }

  /**
   * The location a create with the same ids resolves, with no effects. The
   * resolver is the one chat creation calls; the create route adds the checks
   * that need the executor configuration, not the owner's rows.
   */
  async getStartLocation(
    ownerUserId: string,
    projectId: string,
    input: StartLocationInput,
  ): Promise<StartLocation> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const project = await new ProjectsRepository(tx).findById(
        projectId,
        ownerUserId,
      );
      if (project === undefined) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
      return resolveStartLocation(
        new ProjectLinksRepository(tx),
        ownerUserId,
        project,
        input,
      );
    });
  }

  /**
   * Record the checkout a successful chat start used as the link's default on
   * that executor, replacing a previous choice and stamping `updated_at`.
   * Refuses anything but a `main` checkout of the linked repository on that
   * executor, which is the rule no foreign key can state.
   */
  async recordProjectDefault(
    ownerUserId: string,
    linkId: string,
    executorId: string,
    checkoutId: string,
  ): Promise<ProjectRepositoryDefault> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const links = new ProjectLinksRepository(tx);
      const link = await links.findLinkById(ownerUserId, linkId);
      if (link === undefined) {
        throw new NotFoundException(
          `Project repository link ${linkId} not found`,
        );
      }
      const checkout = await links.findCheckout(ownerUserId, checkoutId);
      const problem = defaultTargetProblem(checkout, link, executorId);
      if (problem !== null) {
        throw new UnprocessableEntityException(
          `Checkout ${checkoutId} cannot be the default of link ${linkId} on executor ${executorId}: ${problem}.`,
        );
      }
      return links.upsertDefault({
        ownerUserId,
        projectRepositoryId: link.id,
        executorId,
        checkoutId,
      });
    });
  }
}

type ProjectLinkInput = {
  readonly repositoryId: string;
  readonly alias?: string;
  readonly isPrimary?: boolean;
  readonly isolation?: ProjectRepositoryIsolation;
};

type ProjectLinkPatch = {
  readonly alias?: string;
  readonly isPrimary?: boolean;
  readonly isolation?: ProjectRepositoryIsolation;
};

const LINK_CONFLICT =
  'The project already links that repository or names another primary link; reload and try again.';
