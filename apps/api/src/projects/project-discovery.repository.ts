/**
 * The owner-scoped read model of one Project's linked repositories and their
 * registered checkouts (project-discovery D5/D6), plus the metadata-only
 * Project listing the discovery reader renders.
 *
 * Each detail read is one batched join: there is no per-repository query and
 * no crawl of the owner's unrelated checkout inventory. The query starts from
 * the Project's links, so a checkout appears only if its repository is linked
 * to that Project and every joined table is owner-filtered as defense in
 * depth. RLS is the primary isolation guarantee; the explicit filter is the
 * seatbelt, mirroring `ProjectsRepository`.
 *
 * A listing selects only its discovery metadata, never owner instructions,
 * and leaves ordering to the renderer, which sorts scalars in code-point
 * order rather than trusting the database collation.
 *
 * Rows are intent, not observation: a stored `path` is disclosed verbatim and
 * this read contacts no executor, Machine, filesystem, or git repository. A
 * repository with no checkout keeps an empty checkout list rather than
 * disappearing from the join. Both `main` and `worktree` records are returned,
 * and the renderer owns their stable order.
 */

import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import {
  checkouts,
  projectRepositories,
  projects,
  repositories,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  type ProjectCheckoutView,
  type ProjectListingRecord,
  type ProjectRepositoryView,
} from './project-document';

/** One projected row: the repository's view fields and its nullable checkout. */
type LinkedRepositoryRow = Omit<ProjectRepositoryView, 'checkouts'> & {
  readonly checkout: ProjectCheckoutView | null;
};

/** The accumulator: a view whose checkout list is still being appended to. */
type PendingRepositoryView = Omit<ProjectRepositoryView, 'checkouts'> & {
  readonly checkouts: Array<ProjectCheckoutView>;
};

export class ProjectDiscoveryRepository {
  constructor(private readonly db: Db) {}

  /**
   * One owner's active or archived Project discovery metadata. Instructions
   * and repository inventories stay out of the listing load entirely, and no
   * `ORDER BY` is spent on a result the renderer sorts by scalar value.
   */
  async listProjects(
    ownerUserId: string,
    archived: boolean,
  ): Promise<Array<ProjectListingRecord>> {
    return this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        archivedAt: projects.archivedAt,
      })
      .from(projects)
      .where(
        and(
          eq(projects.ownerUserId, ownerUserId),
          archived
            ? isNotNull(projects.archivedAt)
            : isNull(projects.archivedAt),
        ),
      );
  }

  /** The linked repositories of one owned Project with every registered
   *  owner checkout, zero-checkout repositories included. */
  async listForProject(
    ownerUserId: string,
    projectId: string,
  ): Promise<Array<ProjectRepositoryView>> {
    const rows: ReadonlyArray<LinkedRepositoryRow> = await this.db
      .select({
        id: repositories.id,
        alias: projectRepositories.alias,
        displayName: repositories.displayName,
        canonicalRemote: repositories.canonicalRemote,
        isPrimary: projectRepositories.isPrimary,
        checkout: {
          id: checkouts.id,
          kind: checkouts.kind,
          parentCheckoutId: checkouts.parentCheckoutId,
          executorId: checkouts.executorId,
          locator: checkouts.path,
        },
      })
      .from(projectRepositories)
      .innerJoin(
        repositories,
        eq(repositories.id, projectRepositories.repositoryId),
      )
      .leftJoin(
        checkouts,
        and(
          eq(checkouts.ownerUserId, projectRepositories.ownerUserId),
          eq(checkouts.repositoryId, projectRepositories.repositoryId),
        ),
      )
      .where(
        and(
          eq(projectRepositories.ownerUserId, ownerUserId),
          eq(projectRepositories.projectId, projectId),
          eq(repositories.ownerUserId, ownerUserId),
        ),
      );

    return groupRepositories(rows);
  }
}

/** Group the batched rows by repository, keeping a zero-checkout repository. */
function groupRepositories(
  rows: ReadonlyArray<LinkedRepositoryRow>,
): Array<ProjectRepositoryView> {
  const byId = new Map<string, PendingRepositoryView>();

  for (const row of rows) {
    const view = byId.get(row.id) ?? {
      id: row.id,
      alias: row.alias,
      displayName: row.displayName,
      canonicalRemote: row.canonicalRemote,
      isPrimary: row.isPrimary,
      checkouts: [],
    };

    byId.set(row.id, view);

    if (row.checkout !== null) view.checkouts.push(row.checkout);
  }

  return [...byId.values()];
}
