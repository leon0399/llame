/**
 * Owner-scoped data access for the repository catalog, its aliases, the
 * checkouts, and the worktree leases.
 *
 * Every query filters by `ownerUserId` as defense in depth. RLS — an
 * owner-only policy with FORCE ROW LEVEL SECURITY on all four tables — is the
 * primary isolation guarantee, and the filter is the seatbelt, mirroring
 * `ProjectsRepository`'s own documented rationale.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  type Checkout,
  type CheckoutKind,
  type CheckoutOrigin,
  chats,
  type Repository,
  type RepositoryAlias,
  checkouts,
  repositories,
  repositoryAliases,
  worktreeLeases,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class RepositoriesRepository {
  constructor(private readonly db: Db) {}

  async listRepositories(ownerUserId: string): Promise<Array<Repository>> {
    return this.db
      .select()
      .from(repositories)
      .where(eq(repositories.ownerUserId, ownerUserId))
      .orderBy(desc(repositories.createdAt));
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

  async findRepositoryByRemote(
    ownerUserId: string,
    canonicalRemote: string,
  ): Promise<Repository | undefined> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.canonicalRemote, canonicalRemote),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findRepositoryByAlias(
    ownerUserId: string,
    canonicalAlias: string,
  ): Promise<Repository | undefined> {
    const rows = await this.db
      .select({ repository: repositories })
      .from(repositoryAliases)
      .innerJoin(
        repositories,
        and(
          eq(repositories.ownerUserId, repositoryAliases.ownerUserId),
          eq(repositories.id, repositoryAliases.repositoryId),
        ),
      )
      .where(
        and(
          eq(repositoryAliases.ownerUserId, ownerUserId),
          eq(repositoryAliases.canonicalAlias, canonicalAlias),
        ),
      )
      .limit(1);
    return rows[0]?.repository;
  }

  /**
   * Serialize this owner's claims of one canonical remote for the rest of the
   * transaction. A canonical remote and an alias are unique in their own table,
   * so no single key refuses a claim that spans both; without this lock, a
   * check-then-write in one direction can miss a concurrent write in the
   * other, and one remote would name two repositories. The lock is
   * transaction-scoped — released on commit or rollback — and keyed by owner
   * and remote, so two owners never wait on each other.
   */
  async lockRemoteClaim(
    ownerUserId: string,
    canonicalRemote: string | null,
  ): Promise<void> {
    await this.db.execute(sql`
      select pg_advisory_xact_lock(
        hashtext('repository-remotes'),
        hashtext(${`${ownerUserId}:${canonicalRemote ?? ''}`})
      )
    `);
  }

  /**
   * The new row, or `undefined` when the owner already holds that remote. The
   * unique key is the guard, not a preceding read: `ON CONFLICT DO NOTHING`
   * lets a concurrent adoption resolve on the winner's committed row instead of
   * aborting the caller's transaction.
   */
  async createRepository(input: {
    readonly ownerUserId: string;
    readonly displayName: string;
    readonly canonicalRemote: string | null;
  }): Promise<Repository | undefined> {
    const [created] = await this.db
      .insert(repositories)
      .values(input)
      .onConflictDoNothing({
        target: [repositories.ownerUserId, repositories.canonicalRemote],
      })
      .returning();
    return created;
  }

  async updateRepository(
    ownerUserId: string,
    repositoryId: string,
    patch: {
      readonly displayName?: string;
      readonly canonicalRemote?: string | null;
    },
  ): Promise<Repository | undefined> {
    if (Object.keys(patch).length === 0) {
      return this.findRepository(ownerUserId, repositoryId);
    }
    const [updated] = await this.db
      .update(repositories)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.id, repositoryId),
        ),
      )
      .returning();
    return updated;
  }

  async deleteRepository(
    ownerUserId: string,
    repositoryId: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(repositories)
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.id, repositoryId),
        ),
      )
      .returning({ id: repositories.id });
    return deleted.length > 0;
  }

  /** The new alias, or `undefined` when the owner already declared that one. */
  async declareAlias(input: {
    readonly ownerUserId: string;
    readonly repositoryId: string;
    readonly canonicalAlias: string;
  }): Promise<RepositoryAlias | undefined> {
    const [created] = await this.db
      .insert(repositoryAliases)
      .values(input)
      .onConflictDoNothing({
        target: [
          repositoryAliases.ownerUserId,
          repositoryAliases.canonicalAlias,
        ],
      })
      .returning();
    return created;
  }

  async listAliases(
    ownerUserId: string,
    repositoryId: string,
  ): Promise<Array<RepositoryAlias>> {
    return this.db
      .select()
      .from(repositoryAliases)
      .where(
        and(
          eq(repositoryAliases.ownerUserId, ownerUserId),
          eq(repositoryAliases.repositoryId, repositoryId),
        ),
      )
      .orderBy(asc(repositoryAliases.createdAt));
  }

  async listCheckouts(
    ownerUserId: string,
    repositoryId?: string,
  ): Promise<Array<Checkout>> {
    const conditions = [eq(checkouts.ownerUserId, ownerUserId)];
    if (repositoryId !== undefined) {
      conditions.push(eq(checkouts.repositoryId, repositoryId));
    }
    return this.db
      .select()
      .from(checkouts)
      .where(and(...conditions))
      .orderBy(asc(checkouts.createdAt), asc(checkouts.id));
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

  async findCheckoutByPath(
    ownerUserId: string,
    executorId: string,
    path: string,
  ): Promise<Checkout | undefined> {
    const rows = await this.db
      .select()
      .from(checkouts)
      .where(
        and(
          eq(checkouts.ownerUserId, ownerUserId),
          eq(checkouts.executorId, executorId),
          eq(checkouts.path, path),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** The new row, or `undefined` when the owner already holds that path here. */
  async createCheckout(input: {
    readonly ownerUserId: string;
    readonly repositoryId: string;
    readonly executorId: string;
    readonly path: string;
    readonly kind: CheckoutKind;
    readonly parentCheckoutId: string | null;
    readonly branch: string | null;
    readonly origin: CheckoutOrigin;
  }): Promise<Checkout | undefined> {
    const [created] = await this.db
      .insert(checkouts)
      .values(input)
      .onConflictDoNothing({
        target: [checkouts.ownerUserId, checkouts.executorId, checkouts.path],
      })
      .returning();
    return created;
  }

  async setWorktreeBase(
    ownerUserId: string,
    checkoutId: string,
    worktreeBase: string,
  ): Promise<Checkout | undefined> {
    const [updated] = await this.db
      .update(checkouts)
      .set({ worktreeBase, updatedAt: new Date() })
      .where(
        and(
          eq(checkouts.ownerUserId, ownerUserId),
          eq(checkouts.id, checkoutId),
        ),
      )
      .returning();
    return updated;
  }

  async deleteCheckout(
    ownerUserId: string,
    checkoutId: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(checkouts)
      .where(
        and(
          eq(checkouts.ownerUserId, ownerUserId),
          eq(checkouts.id, checkoutId),
        ),
      )
      .returning({ id: checkouts.id });
    return deleted.length > 0;
  }

  /**
   * The owner's chats whose Workspace root equals one of `paths`, keyed by that
   * path. A checkout and a binding store the same canonical string, so the
   * comparison is a plain equality — no path arithmetic, no `realpath`.
   */
  async chatsBoundTo(
    ownerUserId: string,
    paths: ReadonlyArray<string>,
  ): Promise<Map<string, Array<string>>> {
    if (paths.length === 0) return new Map();
    const rows = await this.db
      .select({ id: chats.id, root: chats.workspaceRoot })
      .from(chats)
      .where(
        and(
          eq(chats.ownerUserId, ownerUserId),
          inArray(chats.workspaceRoot, [...paths]),
        ),
      )
      .orderBy(asc(chats.createdAt), asc(chats.id));
    const bound = new Map<string, Array<string>>();
    for (const row of rows) {
      if (row.root === null) continue;
      const ids = bound.get(row.root) ?? [];
      ids.push(row.id);
      bound.set(row.root, ids);
    }
    return bound;
  }

  /** The lease chat of each requested checkout; the earliest lease wins. */
  async leaseChats(
    ownerUserId: string,
    checkoutIds: ReadonlyArray<string>,
  ): Promise<Map<string, string>> {
    if (checkoutIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        checkoutId: worktreeLeases.checkoutId,
        chatId: worktreeLeases.chatId,
      })
      .from(worktreeLeases)
      .where(
        and(
          eq(worktreeLeases.ownerUserId, ownerUserId),
          inArray(worktreeLeases.checkoutId, [...checkoutIds]),
        ),
      )
      .orderBy(asc(worktreeLeases.createdAt), asc(worktreeLeases.id));
    const leaseChat = new Map<string, string>();
    for (const row of rows) {
      if (!leaseChat.has(row.checkoutId))
        leaseChat.set(row.checkoutId, row.chatId);
    }
    return leaseChat;
  }
}
