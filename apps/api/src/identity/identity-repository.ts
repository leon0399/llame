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
import { childPath, isDescendantPath, pathIds, rootPath } from './org-path';

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
  async move(
    unit: Pick<OrgUnit, 'id'>,
    newParent: Pick<OrgUnit, 'id' | 'path'>,
  ): Promise<void> {
    const rows = await this.lockTreeRoots([unit.id, newParent.id]);
    const locked = rows.get(unit.id);
    if (!locked) {
      throw new Error(`Org unit ${unit.id} not found`);
    }
    const lockedNewParent = rows.get(newParent.id);
    if (!lockedNewParent) {
      throw new Error(`Org unit ${newParent.id} not found`);
    }

    if (
      lockedNewParent.id === locked.id ||
      lockedNewParent.path === locked.path ||
      isDescendantPath(lockedNewParent.path, locked.path)
    ) {
      throw new Error('Cannot move an org unit into its own subtree.');
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

    await this.db
      .update(orgUnits)
      .set({ parentId: lockedNewParent.id, updatedAt: new Date() })
      .where(eq(orgUnits.id, locked.id));
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
