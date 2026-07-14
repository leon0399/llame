/**
 * ProjectsRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId as defense-in-depth. RLS (`projects_owner`,
 * FORCE) is the primary isolation guarantee; this filter is the seatbelt —
 * mirrors ChatsRepository's own documented rationale (chats-repository.ts).
 */

import { and, desc, eq, exists, isNotNull, isNull, not } from 'drizzle-orm';
import { assertNotArchived } from '../db/assert-not-archived';
import { type Project, pins, projects, type PinItemType } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';

export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  /** List a user's projects, honoring the archive/pin filters; updatedAt desc. */
  async listForUser(
    ownerUserId: string,
    filter: {
      pinned?: 'only' | 'with' | 'exclude';
      archived?: 'only' | 'with';
    } = {},
  ): Promise<Project[]> {
    const conditions = [eq(projects.ownerUserId, ownerUserId)];

    if (filter.archived === 'only') {
      conditions.push(isNotNull(projects.archivedAt));
    } else if (filter.archived !== 'with') {
      conditions.push(isNull(projects.archivedAt));
    }

    if (filter.pinned === 'only' || filter.pinned === 'exclude') {
      const pinSubquery = this.db
        .select({ itemId: pins.itemId })
        .from(pins)
        .where(
          and(
            eq(pins.userId, ownerUserId),
            eq(pins.itemType, 'project' as PinItemType),
            eq(pins.itemId, projects.id),
          ),
        );
      conditions.push(
        filter.pinned === 'only'
          ? exists(pinSubquery)
          : not(exists(pinSubquery)),
      );
    }

    return this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt));
  }

  /**
   * Find a single project by id, requiring ownership match (defense-in-depth).
   * Returns undefined if not found or not owned by this user.
   */
  async findById(
    projectId: string,
    ownerUserId: string,
  ): Promise<Project | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.ownerUserId, ownerUserId)),
      )
      .limit(1);

    return rows[0];
  }

  /** Create a new project owned by a user. */
  async create(input: { ownerUserId: string; name: string }): Promise<Project> {
    const [created] = await this.db
      .insert(projects)
      .values({ ownerUserId: input.ownerUserId, name: input.name })
      .returning();

    return created;
  }

  /**
   * Apply a partial update to a project, scoped to owner (defense-in-depth).
   * Only provided fields are changed. Returns undefined if not found or not
   * owned by this user.
   */
  async update(
    projectId: string,
    ownerUserId: string,
    patch: { name?: string; archived?: boolean },
  ): Promise<Project | undefined> {
    const current = await this.findById(projectId, ownerUserId);
    if (!current) return undefined;

    // Archive guard (chat-project-archive): an archived project rejects every
    // write except unarchive (archived === false).
    if (patch.archived !== false) {
      assertNotArchived(current);
    }

    const fields = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.archived === true
        ? { archivedAt: new Date() }
        : patch.archived === false
          ? { archivedAt: null }
          : {}),
    };

    // Nothing to change: don't issue a no-op write. Return the current row
    // instead — still owner-scoped, so the caller gets the project on a
    // match and undefined (→ 404) when it's absent / not owned.
    if (Object.keys(fields).length === 0) {
      return current;
    }

    const contentChanged = patch.name !== undefined;

    const [updated] = await this.db
      .update(projects)
      .set(contentChanged ? { ...fields, updatedAt: new Date() } : fields)
      .where(
        and(eq(projects.id, projectId), eq(projects.ownerUserId, ownerUserId)),
      )
      .returning();

    return updated;
  }

  /**
   * Delete a project, scoped to owner (defense-in-depth on top of RLS).
   * Returns true iff a row was removed → false maps to 404. Filed chats are
   * unfiled (ON DELETE SET NULL on chats.project_id), never deleted.
   */
  async delete(projectId: string, ownerUserId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.ownerUserId, ownerUserId)),
      )
      .returning({ id: projects.id });

    return deleted.length > 0;
  }
}
