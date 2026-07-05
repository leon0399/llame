/**
 * OrgUnitsRepository / MembershipsRepository / ExternalIdentitiesRepository
 * (#44, SPEC §6.1/§7.1–§7.3) — owner-scoped access to the identity model.
 *
 * Same defense-in-depth contract as the chat repositories: RLS (FORCE) is the
 * moat, and queries still filter explicitly where a user id is part of the
 * question. All writes assume a TenantDbService.runAs context.
 */

import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import {
  externalIdentities,
  memberships,
  orgUnits,
  type ExternalIdentity,
  type Membership,
  type OrgRole,
  type OrgUnit,
  type OrgUnitType,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { childPath, isDescendantPath, rootPath } from './org-path';

export class OrgUnitsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create a root unit. The id is generated first so the materialized path
   * (its own id) can be written in the same INSERT.
   */
  async createRoot(input: {
    name: string;
    type?: OrgUnitType;
    createdBy: string;
    settings?: Record<string, unknown>;
  }): Promise<OrgUnit> {
    const id = crypto.randomUUID();
    const [created] = await this.db
      .insert(orgUnits)
      .values({
        id,
        name: input.name,
        ...(input.type ? { type: input.type } : {}),
        path: rootPath(id),
        createdBy: input.createdBy,
        ...(input.settings ? { settings: input.settings } : {}),
      })
      .returning();
    return created;
  }

  /**
   * Create a child under `parent`. The caller passes the parent ROW (not just
   * an id) — it was necessarily read through RLS, so an invisible parent can
   * never be extended.
   */
  async createChild(input: {
    parent: Pick<OrgUnit, 'id' | 'path'>;
    name: string;
    type?: OrgUnitType;
    createdBy: string;
    settings?: Record<string, unknown>;
  }): Promise<OrgUnit> {
    const id = crypto.randomUUID();
    const [created] = await this.db
      .insert(orgUnits)
      .values({
        id,
        parentId: input.parent.id,
        name: input.name,
        ...(input.type ? { type: input.type } : {}),
        path: childPath(input.parent.path, id),
        createdBy: input.createdBy,
        ...(input.settings ? { settings: input.settings } : {}),
      })
      .returning();
    return created;
  }

  async findById(id: string): Promise<OrgUnit | undefined> {
    const rows = await this.db
      .select()
      .from(orgUnits)
      .where(eq(orgUnits.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Every org unit VISIBLE to the caller — no explicit filter: `org_units_select`
   * (member-on-path OR creator) scopes it. Path-ordered (parents before children).
   */
  async listVisible(): Promise<OrgUnit[]> {
    return this.db.select().from(orgUnits).orderBy(asc(orgUnits.path));
  }

  /** A unit and its whole subtree, path-ordered (parents before children). */
  async findSubtree(unit: Pick<OrgUnit, 'path'>): Promise<OrgUnit[]> {
    return this.db
      .select()
      .from(orgUnits)
      .where(
        or(eq(orgUnits.path, unit.path), like(orgUnits.path, `${unit.path}/%`)),
      )
      .orderBy(asc(orgUnits.path));
  }

  /**
   * Move a subtree under a new parent (#44 acceptance: path stays consistent
   * across the subtree). One UPDATE rewrites every descendant's path prefix.
   * Refuses a move into the subtree itself — that would detach it into a
   * cycle. Rename needs no path work at all (paths are id-based).
   */
  async move(
    unit: Pick<OrgUnit, 'id' | 'path'>,
    newParent: Pick<OrgUnit, 'id' | 'path'>,
  ): Promise<void> {
    if (
      newParent.id === unit.id ||
      newParent.path === unit.path ||
      isDescendantPath(newParent.path, unit.path)
    ) {
      throw new Error('Cannot move an org unit into its own subtree.');
    }

    const oldPrefix = unit.path;
    const newPrefix = childPath(newParent.path, unit.id);

    await this.db
      .update(orgUnits)
      .set({
        // Prefix rewrite. substr(text, int) — NOT `substring(x from y)`: with
        // a bind parameter the latter resolves to the POSIX-REGEX form
        // (substring(text from text)), silently yielding NULL. The RLS
        // WITH CHECK caught exactly that during #44 development.
        path: sql`${newPrefix} || substr(${orgUnits.path}, ${oldPrefix.length + 1}::int)`,
        updatedAt: new Date(),
      })
      .where(
        or(eq(orgUnits.path, oldPrefix), like(orgUnits.path, `${oldPrefix}/%`)),
      );

    await this.db
      .update(orgUnits)
      .set({ parentId: newParent.id, updatedAt: new Date() })
      .where(eq(orgUnits.id, unit.id));
  }

  async rename(id: string, name: string): Promise<OrgUnit | undefined> {
    const [updated] = await this.db
      .update(orgUnits)
      .set({ name, updatedAt: new Date() })
      .where(eq(orgUnits.id, id))
      .returning();
    return updated;
  }
}

export class MembershipsRepository {
  constructor(private readonly db: Db) {}

  /**
   * No RETURNING here, deliberately: Postgres applies the SELECT policy to
   * rows read back by INSERT…RETURNING, and a granted row belongs to the
   * GRANTEE — invisible under the granter's own-rows-only select policy
   * (fail closed). The write itself is what matters.
   */
  async grant(input: {
    userId: string;
    orgUnitId: string;
    role: OrgRole;
  }): Promise<void> {
    await this.db.insert(memberships).values(input);
  }

  /** The user's memberships attached to any of the given units. */
  async findByUserOnUnits(
    userId: string,
    orgUnitIds: string[],
  ): Promise<Membership[]> {
    if (orgUnitIds.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          inArray(memberships.orgUnitId, orgUnitIds),
        ),
      );
  }

  async listByUser(userId: string): Promise<Membership[]> {
    return this.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt));
  }

  async revoke(userId: string, orgUnitId: string): Promise<void> {
    await this.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.orgUnitId, orgUnitId),
        ),
      );
  }
}

export class ExternalIdentitiesRepository {
  constructor(private readonly db: Db) {}

  async link(input: {
    userId: string;
    provider: string;
    externalSubject: string;
    metadata?: unknown;
  }): Promise<ExternalIdentity> {
    const [created] = await this.db
      .insert(externalIdentities)
      .values(input)
      .returning();
    return created;
  }

  async listByUser(userId: string): Promise<ExternalIdentity[]> {
    return this.db
      .select()
      .from(externalIdentities)
      .where(eq(externalIdentities.userId, userId))
      .orderBy(asc(externalIdentities.createdAt));
  }

  async unlink(userId: string, id: string): Promise<void> {
    await this.db
      .delete(externalIdentities)
      .where(
        and(
          eq(externalIdentities.id, id),
          eq(externalIdentities.userId, userId),
        ),
      );
  }
}
