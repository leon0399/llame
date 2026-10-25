/**
 * Owner-scoped data access for project repository links (openspec
 * `projects`).
 *
 * Every query filters by `ownerUserId` as defense in depth. RLS — a policy that
 * admits a row only through a project the caller owns, with FORCE ROW LEVEL
 * SECURITY on the table — is the primary isolation guarantee; the filter is the
 * seatbelt, mirroring `ProjectsRepository`'s own rationale.
 */

import { and, asc, eq } from 'drizzle-orm';

import {
  type ProjectRepository,
  type Repository,
  projectRepositories,
  repositories,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class ProjectLinksRepository {
  constructor(private readonly db: Db) {}

  /** The project's links, oldest first, with the alias as the stable tiebreak. */
  async listLinks(
    ownerUserId: string,
    projectId: string,
  ): Promise<Array<ProjectRepository>> {
    return this.db
      .select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.projectId, projectId),
        ),
      )
      .orderBy(
        asc(projectRepositories.createdAt),
        asc(projectRepositories.alias),
      );
  }

  async findLinkByRepository(
    ownerUserId: string,
    projectId: string,
    repositoryId: string,
  ): Promise<ProjectRepository | undefined> {
    const rows = await this.db
      .select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.repositoryId, repositoryId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The new link, or `undefined` when the project already links that
   * repository. The unique key is the guard, not a preceding read, so a
   * concurrent link resolves on the loser's `undefined`.
   */
  async createLink(input: {
    readonly ownerUserId: string;
    readonly projectId: string;
    readonly repositoryId: string;
    readonly alias: string;
    readonly isPrimary: boolean;
    readonly isolation: ProjectRepository['isolation'];
  }): Promise<ProjectRepository | undefined> {
    const [created] = await this.db
      .insert(projectRepositories)
      .values(input)
      .onConflictDoNothing({
        target: [
          projectRepositories.ownerUserId,
          projectRepositories.projectId,
          projectRepositories.repositoryId,
        ],
      })
      .returning();
    return created;
  }

  async updateLink(
    ownerUserId: string,
    linkId: string,
    patch: {
      readonly alias?: string;
      readonly isPrimary?: boolean;
      readonly isolation?: ProjectRepository['isolation'];
    },
  ): Promise<ProjectRepository | undefined> {
    const [updated] = await this.db
      .update(projectRepositories)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.id, linkId),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * Clear the project's primary flag. The partial unique index admits one
   * primary per project, so the writer clears the previous one in the same
   * transaction, before it sets the new one.
   */
  async clearPrimary(ownerUserId: string, projectId: string): Promise<void> {
    await this.db
      .update(projectRepositories)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.isPrimary, true),
        ),
      );
  }

  /** True iff a link row was removed. */
  async deleteLink(
    ownerUserId: string,
    projectId: string,
    linkId: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(projectRepositories)
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.id, linkId),
        ),
      )
      .returning({ id: projectRepositories.id });
    return deleted.length > 0;
  }

  async findRepository(
    ownerUserId: string,
    repositoryId: string,
  ): Promise<Repository | undefined> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.id, repositoryId),
        ),
      )
      .limit(1);
    return rows[0];
  }
}
