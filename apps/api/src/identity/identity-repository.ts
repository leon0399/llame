/**
 * OrgUnitsRepository / MembershipsRepository / ExternalIdentitiesRepository
 * (#44, SPEC §6.1/§7.1–§7.3) — owner-scoped access to the identity model.
 *
 * Same defense-in-depth contract as the chat repositories: RLS (FORCE) is the
 * moat, and queries still filter explicitly where a user id is part of the
 * question. All writes assume a TenantDbService.runAs context.
 */

import { and, asc, count, eq, inArray, like, or, sql } from 'drizzle-orm';
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
import { childPath, isDescendantPath, pathIds, rootPath } from './org-path';

/**
 * A row this structural write depends on vanished between the caller's
 * visibility pre-check and the lock-then-reread (D1's residual "tree changed
 * under us" outcome). Typed — not matched by message text — so the service
 * can map exactly this to a retryable 409 without reclassifying unrelated
 * errors that merely mention "not found".
 */
export class ConcurrentTreeChangeError extends Error {}

/** The requested move would place a unit inside its own subtree (422). */
export class MoveIntoOwnSubtreeError extends Error {}

/**
 * Read enrichment (admin-area-org-tree, D3): a unit's member count + the
 * caller's own DIRECT role on it (null when they hold no direct membership
 * there — an inherited role from an ancestor is not this field).
 */
export type MembershipSummary = {
  memberCount: number;
  directRole: OrgRole | null;
};

/** An org unit plus its read enrichment — the shape `OrgUnitResponse` mirrors. */
export type OrgUnitWithSummary = OrgUnit & MembershipSummary;

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

  /** Same as `findById`, but takes a row lock (see `lockTreeRoot`). */
  private async findByIdForUpdate(id: string): Promise<OrgUnit | undefined> {
    const rows = await this.db
      .select()
      .from(orgUnits)
      .where(eq(orgUnits.id, id))
      .for('update')
      .limit(1);
    return rows[0];
  }

  /**
   * Lock the TREE ROOT(S) (first path segment) implied by the CURRENT paths
   * of `ids`, FOR UPDATE — the shared mutex every structural write (D1)
   * acquires before deriving anything from a path in that tree, and before
   * it touches any row in it.
   *
   * Locking only the row directly being read/moved (the original design) is
   * insufficient: a child created under a *descendant* of a subtree that is
   * concurrently being moved locks a DIFFERENT row than the moved subtree's
   * root, so the two operations never contend. Under READ COMMITTED, the
   * move's bulk path-rewrite UPDATE fixes its candidate-row snapshot at
   * statement start; a child inserted (and committed) by the other
   * transaction afterward is invisible to it — the insert is internally
   * consistent against the pre-move parent path it read, and the move never
   * touches a row it never saw, so NEITHER catches the resulting
   * inconsistency and no trigger fires for it either. A single lock point
   * per tree fixes this: the loser of any race blocks HERE, so its first
   * read of anything in the tree happens only after the winner has already
   * committed.
   *
   * F4: an id's tree root is itself determined by an UNLOCKED read (we don't
   * know which root to lock until we've read the row) — so a concurrent
   * mover could reparent that unit into a DIFFERENT tree in the gap between
   * this read and the lock acquisition, reopening the very race the lock
   * exists to close (we'd be holding the wrong tree's mutex). Fixed with a
   * lock-then-verify loop: lock every currently-known candidate root, then
   * re-read every id — if any now resolves to a root we haven't locked (it
   * moved again while we were locking), lock that too and repeat. Locks are
   * only ever added, never released mid-transaction, so an extra lock on a
   * root that turned out to be irrelevant is harmless, and the loop
   * terminates as soon as a read agrees with the locked set (in practice,
   * immediately — this requires a mover to win a race in the exact gap
   * between our read and our lock, repeatedly). The first pass locks
   * multiple roots in sorted order (D1's cross-tree deadlock-avoidance
   * ordering for the expected, stable case); a root discovered only on a
   * later pass breaks strict global ordering in the rare case a unit moves
   * trees while we're still acquiring locks — Postgres's own deadlock
   * detector (aborting one side with a retryable error) is the backstop for
   * that residual window, the same as for any dynamically-discovered lock
   * ordering scheme.
   */
  private async lockTreeRoots(
    ids: string[],
  ): Promise<Map<string, OrgUnit | undefined>> {
    const lockedRoots = new Set<string>();
    for (;;) {
      const rows = new Map<string, OrgUnit | undefined>();
      for (const id of ids) {
        rows.set(id, await this.findById(id));
      }
      const neededRoots = new Set<string>();
      for (const row of rows.values()) {
        if (row) {
          neededRoots.add(pathIds(row.path)[0]);
        }
      }
      const toLock = [...neededRoots]
        .filter((rootId) => !lockedRoots.has(rootId))
        .sort();
      if (toLock.length === 0) {
        return rows;
      }
      for (const rootId of toLock) {
        await this.findByIdForUpdate(rootId);
        lockedRoots.add(rootId);
      }
    }
  }

  /**
   * Read a unit for use as a `createChild` target, having first locked its
   * tree root, re-reading until stable (D1/F4 — see `lockTreeRoots`).
   */
  async findByIdInLockedTree(id: string): Promise<OrgUnit | undefined> {
    const rows = await this.lockTreeRoots([id]);
    return rows.get(id);
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
   *
   * D1 race closure: locks the moved unit's CURRENT tree root, and — for a
   * cross-tree move (the destination is in a different tree; reachable once
   * `PATCH parentId` accepts any visible parent) — the destination tree's
   * root too, both in id order (deadlock avoidance against a concurrent move
   * crossing the same two trees in the opposite direction), before deriving
   * `oldPrefix`/`newPrefix` from FRESH reads of both `unit` and `newParent`
   * rather than the caller-supplied values (either can already be stale by
   * call time — see `lockTreeRoots`' doc for why locking anything narrower
   * than the tree root, or trusting a pre-lock read, doesn't close the
   * race). Move-to-root (`newParent` absent) needs only the source root.
   */
  /**
   * Returns the moved unit's post-move row, or `undefined` when the update
   * affected zero rows — the RLS zero-rows-under-USING landmine (3.x): if the
   * caller lacks admin-tier anywhere on the OLD path, `org_units_update`'s
   * USING clause filters out every row in the subtree (this one included)
   * before WITH CHECK is even considered, so the UPDATE silently "succeeds"
   * having touched nothing — no exception. Checking the single-row
   * `parentId` update's RETURNING is a valid proxy for the whole subtree's
   * outcome: every row shares this unit's id as a path segment, so caller
   * admin-tier on the old path is uniformly present or uniformly absent
   * across the WHOLE subtree (see the withCheck reasoning in the same
   * comment for why this also holds for the destination side). Callers MUST
   * check this and map it to 403 — never treat it as success (landmine:
   * "a denied admin op must NEVER return success").
   */
  async move(
    unit: Pick<OrgUnit, 'id'>,
    newParent: Pick<OrgUnit, 'id' | 'path'>,
  ): Promise<OrgUnit | undefined> {
    const rows = await this.lockTreeRoots([unit.id, newParent.id]);
    const locked = rows.get(unit.id);
    if (!locked) {
      throw new ConcurrentTreeChangeError(`Org unit ${unit.id} not found`);
    }
    const lockedNewParent = rows.get(newParent.id);
    if (!lockedNewParent) {
      throw new ConcurrentTreeChangeError(`Org unit ${newParent.id} not found`);
    }

    if (
      lockedNewParent.id === locked.id ||
      lockedNewParent.path === locked.path ||
      isDescendantPath(lockedNewParent.path, locked.path)
    ) {
      throw new MoveIntoOwnSubtreeError(
        'Cannot move an org unit into its own subtree.',
      );
    }

    const oldPrefix = locked.path;
    const newPrefix = childPath(lockedNewParent.path, locked.id);

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

    const [updated] = await this.db
      .update(orgUnits)
      .set({ parentId: lockedNewParent.id, updatedAt: new Date() })
      .where(eq(orgUnits.id, locked.id))
      .returning();
    return updated;
  }

  /**
   * Move-to-root variant (D5 `PATCH { parentId: null }`): rebase the unit's
   * whole subtree onto its OWN id as the new path prefix and clear
   * `parent_id`. Only the source tree root needs locking — there is no
   * destination tree. Same zero-rows-under-USING contract as `move`: a
   * caller lacking admin-tier on the current path gets an `undefined`
   * return, not a silent no-op success.
   */
  async moveToRoot(unit: Pick<OrgUnit, 'id'>): Promise<OrgUnit | undefined> {
    const rows = await this.lockTreeRoots([unit.id]);
    const locked = rows.get(unit.id);
    if (!locked) {
      throw new ConcurrentTreeChangeError(`Org unit ${unit.id} not found`);
    }

    const oldPrefix = locked.path;
    const newPrefix = locked.id;

    await this.db
      .update(orgUnits)
      .set({
        path: sql`${newPrefix} || substr(${orgUnits.path}, ${oldPrefix.length + 1}::int)`,
        updatedAt: new Date(),
      })
      .where(
        or(eq(orgUnits.path, oldPrefix), like(orgUnits.path, `${oldPrefix}/%`)),
      );

    const [updated] = await this.db
      .update(orgUnits)
      .set({ parentId: null, updatedAt: new Date() })
      .where(eq(orgUnits.id, locked.id))
      .returning();
    return updated;
  }

  async rename(id: string, name: string): Promise<OrgUnit | undefined> {
    const [updated] = await this.db
      .update(orgUnits)
      .set({ name, updatedAt: new Date() })
      .where(eq(orgUnits.id, id))
      .returning();
    return updated;
  }

  async updateSettings(
    id: string,
    settings: Record<string, unknown>,
  ): Promise<OrgUnit | undefined> {
    const [updated] = await this.db
      .update(orgUnits)
      .set({ settings, updatedAt: new Date() })
      .where(eq(orgUnits.id, id))
      .returning();
    return updated;
  }

  /**
   * Leaf-only delete (FK `RESTRICT` on `parent_id` rejects this with 23503
   * when the unit still has children). Returns whether a row was actually
   * removed — `false` maps to 403 (visible but not owner-tier) once the
   * caller has separately confirmed the row exists/is visible; RLS's
   * `org_units_delete` USING (owner-tier only) makes this the same
   * zero-rows-under-USING case as `move`/`moveToRoot`.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(orgUnits)
      .where(eq(orgUnits.id, id))
      .returning({ id: orgUnits.id });
    return deleted.length > 0;
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

  /** The roster of a single unit — visibility (member-on-path) is RLS's job, not this query's. */
  async listByUnit(orgUnitId: string): Promise<Membership[]> {
    return this.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgUnitId, orgUnitId))
      .orderBy(asc(memberships.createdAt));
  }

  /**
   * A single (user, unit) membership row, RLS-scoped (own row, or any
   * member-on-path per D4). Used by the service layer to distinguish
   * "doesn't exist / not visible" (404) from "visible but the write's
   * stricter USING denied it" (403) ahead of a role-change/revoke.
   */
  async findByUserAndUnit(
    userId: string,
    orgUnitId: string,
  ): Promise<Membership | undefined> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.orgUnitId, orgUnitId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Returns the updated row, or `undefined` on a zero-rows UPDATE — the
   * caller could SEE the row (checked separately via `findByUserAndUnit`)
   * but `memberships_update`'s USING denied touching it (not admin/owner-tier,
   * or targeting an owner row without owner-tier). Maps to 403, never a
   * silent no-op success.
   */
  async changeRole(
    userId: string,
    orgUnitId: string,
    role: OrgRole,
  ): Promise<Membership | undefined> {
    const [updated] = await this.db
      .update(memberships)
      .set({ role })
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.orgUnitId, orgUnitId),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * Read enrichment (admin-area-org-tree, D3): member count + the caller's
   * own direct role, for each of `orgUnitIds`. Two queries TOTAL regardless
   * of how many units are requested — never a per-unit round trip. Both are
   * scoped by the caller's existing `memberships_select` RLS visibility (own
   * row, or member-on-path) — this widens nothing: a unit the caller sees
   * only via the creator-bootstrap edge (no roster visibility yet, no
   * membership of their own) legitimately summarizes to
   * `{ memberCount: 0, directRole: null }` (D3, noted/accepted transient
   * state — the service grants the owner row in the same transaction).
   * Units with no rows in either query are absent from the returned map;
   * callers default a missing entry to `{ memberCount: 0, directRole: null }`.
   */
  async summarize(
    userId: string,
    orgUnitIds: string[],
  ): Promise<Map<string, MembershipSummary>> {
    const result = new Map<string, MembershipSummary>();
    if (orgUnitIds.length === 0) {
      return result;
    }

    const counts = await this.db
      .select({ orgUnitId: memberships.orgUnitId, memberCount: count() })
      .from(memberships)
      .where(inArray(memberships.orgUnitId, orgUnitIds))
      .groupBy(memberships.orgUnitId);
    for (const row of counts) {
      result.set(row.orgUnitId, {
        memberCount: row.memberCount,
        directRole: null,
      });
    }

    const own = await this.db
      .select({ orgUnitId: memberships.orgUnitId, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          inArray(memberships.orgUnitId, orgUnitIds),
        ),
      );
    for (const row of own) {
      result.set(row.orgUnitId, {
        memberCount: result.get(row.orgUnitId)?.memberCount ?? 0,
        directRole: row.role,
      });
    }

    return result;
  }

  /**
   * Returns whether a row was actually removed — same zero-rows-under-USING
   * contract as `changeRole`/`move`. DELETE…RETURNING is not subject to the
   * SELECT policy (unlike INSERT…RETURNING, see `grant`'s doc), so this is
   * safe to check directly.
   */
  async revoke(userId: string, orgUnitId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.orgUnitId, orgUnitId),
        ),
      )
      .returning({ id: memberships.id });
    return deleted.length > 0;
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
