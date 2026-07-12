/**
 * ProjectsRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId as defense-in-depth. RLS (`projects_owner`,
 * FORCE) is the primary isolation guarantee; this filter is the seatbelt —
 * mirrors ChatsRepository's own documented rationale (chats-repository.ts).
 */

import { and, desc, eq } from 'drizzle-orm';
import { type Project, projects } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';

export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  /** List a user's projects, newest-created first. */
  async listForUser(ownerUserId: string): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.ownerUserId, ownerUserId))
      .orderBy(desc(projects.createdAt));
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
    patch: { name?: string },
  ): Promise<Project | undefined> {
    // Nothing to change: don't issue a no-op write. Return the current row
    // instead — still owner-scoped, so the caller gets the project on a
    // match and undefined (→ 404) when it's absent / not owned.
    if (patch.name === undefined) {
      return this.findById(projectId, ownerUserId);
    }

    const [updated] = await this.db
      .update(projects)
      .set({ name: patch.name, updatedAt: new Date() })
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
