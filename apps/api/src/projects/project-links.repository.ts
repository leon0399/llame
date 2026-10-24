/**
 * Owner-scoped data access for project repository links and their defaults
 * (openspec `chat-start-location`, design D8).
 *
 * Every query filters by `ownerUserId` as defense in depth. RLS — a policy that
 * admits a row only through a project (or link) the caller owns, with FORCE ROW
 * LEVEL SECURITY on both tables — is the primary isolation guarantee; the
 * filter is the seatbelt, mirroring `ProjectsRepository`'s own rationale.
 *
 * This class also implements `StartLocationSource`, the read subset the shared
 * start-location resolver needs, so the preview route and chat creation resolve
 * a location through one function.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  type Checkout,
  chats,
  checkouts,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
  projectRepositories,
  projectRepositoryDefaults,
  repositories,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import type { StartLocationSource } from './start-location';

export type ProjectLinkWithDefaults = {
  readonly link: ProjectRepository;
  readonly defaults: Array<ProjectRepositoryDefault>;
};

export class ProjectLinksRepository implements StartLocationSource {
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

  async findLinkById(
    ownerUserId: string,
    linkId: string,
  ): Promise<ProjectRepository | undefined> {
    const rows = await this.db
      .select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.id, linkId),
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

  /** True iff a link row was removed; its defaults cascade. */
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

  /** Every default of the given links, most recently written first. */
  async listDefaults(
    ownerUserId: string,
    linkIds: ReadonlyArray<string>,
  ): Promise<Array<ProjectRepositoryDefault>> {
    if (linkIds.length === 0) return [];
    return this.db
      .select()
      .from(projectRepositoryDefaults)
      .where(
        and(
          eq(projectRepositoryDefaults.ownerUserId, ownerUserId),
          inArray(projectRepositoryDefaults.projectRepositoryId, [...linkIds]),
        ),
      )
      .orderBy(
        desc(projectRepositoryDefaults.updatedAt),
        desc(projectRepositoryDefaults.id),
      );
  }

  async findDefault(
    ownerUserId: string,
    linkId: string,
    executorId: string,
  ): Promise<ProjectRepositoryDefault | undefined> {
    const rows = await this.db
      .select()
      .from(projectRepositoryDefaults)
      .where(
        and(
          eq(projectRepositoryDefaults.ownerUserId, ownerUserId),
          eq(projectRepositoryDefaults.projectRepositoryId, linkId),
          eq(projectRepositoryDefaults.executorId, executorId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The most recently written default of one link, across executors. The
   * newest `updated_at` wins; the id is the tiebreak so a same-millisecond
   * pair still resolves deterministically.
   */
  async findLatestDefault(
    ownerUserId: string,
    linkId: string,
  ): Promise<ProjectRepositoryDefault | undefined> {
    const rows = await this.db
      .select()
      .from(projectRepositoryDefaults)
      .where(
        and(
          eq(projectRepositoryDefaults.ownerUserId, ownerUserId),
          eq(projectRepositoryDefaults.projectRepositoryId, linkId),
        ),
      )
      .orderBy(
        desc(projectRepositoryDefaults.updatedAt),
        desc(projectRepositoryDefaults.id),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Store the default of one link on one executor, replacing the previous
   * choice in place and stamping `updated_at` on every write. The caller has
   * already checked that the checkout is a `main` checkout of the link's
   * repository on that executor (`defaultTargetProblem`).
   */
  async upsertDefault(input: {
    readonly ownerUserId: string;
    readonly projectRepositoryId: string;
    readonly executorId: string;
    readonly checkoutId: string;
  }): Promise<ProjectRepositoryDefault> {
    const [row] = await this.db
      .insert(projectRepositoryDefaults)
      .values(input)
      .onConflictDoUpdate({
        target: [
          projectRepositoryDefaults.ownerUserId,
          projectRepositoryDefaults.projectRepositoryId,
          projectRepositoryDefaults.executorId,
        ],
        set: { checkoutId: input.checkoutId, updatedAt: new Date() },
      })
      .returning();
    return row;
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

  async findCheckout(
    ownerUserId: string,
    checkoutId: string,
  ): Promise<Checkout | undefined> {
    const rows = await this.db
      .select()
      .from(checkouts)
      .where(
        and(
          eq(checkouts.ownerUserId, ownerUserId),
          eq(checkouts.id, checkoutId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The `main` checkouts of one repository, narrowed to one executor when one
   * is named. Ordered by executor and path, so the "lowest executor id" step
   * is deterministic.
   */
  async listMainCheckouts(
    ownerUserId: string,
    repositoryId: string,
    executorId?: string,
  ): Promise<Array<Checkout>> {
    return this.db
      .select()
      .from(checkouts)
      .where(
        and(
          eq(checkouts.ownerUserId, ownerUserId),
          eq(checkouts.repositoryId, repositoryId),
          eq(checkouts.kind, 'main'),
          executorId === undefined
            ? undefined
            : eq(checkouts.executorId, executorId),
        ),
      )
      .orderBy(asc(checkouts.executorId), asc(checkouts.path));
  }

  /**
   * How many of the owner's open chats are bound to one root on one executor.
   * The `inherit` isolation policy turns a worktree start on when another open
   * chat already holds the source checkout (design D10).
   */
  async countOpenChatsBoundTo(
    ownerUserId: string,
    root: string,
    executorId: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ chats: sql<number>`count(*)::int` })
      .from(chats)
      .where(
        and(
          eq(chats.ownerUserId, ownerUserId),
          eq(chats.workspaceRoot, root),
          eq(chats.workspaceExecutorId, executorId),
          isNull(chats.archivedAt),
        ),
      );
    return rows[0]?.chats ?? 0;
  }
}
