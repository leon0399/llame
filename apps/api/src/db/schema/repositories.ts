import { InferSelectModel, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { users } from './auth';
import { chats } from './chats';

/**
 * The owner's repository catalog, its aliases, the checkouts where each
 * repository exists on an executor, and the informational worktree leases
 * (openspec `repositories`, design D1-D3).
 *
 * Every table is owner-scoped: an owner-only `pgPolicy` and `.enableRLS()`,
 * with `FORCE ROW LEVEL SECURITY` hand-appended in the migration — Drizzle
 * emits `ENABLE` only (`apps/api/src/db/AGENTS.md` P1).
 *
 * Every child row names its parent with a COMPOSITE owner foreign key
 * `(owner_user_id, parent_id)`, never a single-column one. A foreign-key check
 * and a cascade both bypass RLS, so a single-column key would let one owner's
 * row name another owner's parent, and a parent delete would then cascade
 * across owners. Each parent therefore carries a unique `(owner_user_id, id)`
 * key. The one exception is the lease's chat key: `chats` already carries
 * `chats_id_owner_user_id_unique_idx` on `(id, owner_user_id)`, and a
 * referenced key must be an existing unique index, so that foreign key lists
 * the columns in the index's order. It enforces the same owner match.
 *
 * No foreign key points at `machines_status`, which the hub probe rewrites, and
 * no row carries an observation column: rows are intent, and an unreachable
 * Machine simply leaves its checkouts inert.
 */

// The checkout kind vocabulary, mirrored by `checkouts_kind_check`.
export type CheckoutKind = 'main' | 'worktree';
// The checkout origin vocabulary, mirrored by `checkouts_origin_check`.
export type CheckoutOrigin = 'registered' | 'adopted' | 'created';

/** One repository of one owner; identity is its normalized remote. */
export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** One path segment; the worktree directory embeds it. */
    displayName: text('display_name').notNull(),
    /**
     * The normalized `origin` remote (`github.com/owner/repo`), or NULL for a
     * clone without an `origin`, which takes its identity from its first
     * checkout.
     */
    canonicalRemote: text('canonical_remote'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Two owners may hold one remote; one owner may not hold it twice. Postgres
    // treats NULLs as distinct, so remote-less repositories never collide.
    uniqueIndex('repositories_owner_canonical_remote_uidx').on(
      t.ownerUserId,
      t.canonicalRemote,
    ),
    // Parent key for every composite owner foreign key that names a
    // repository. A table constraint, not an index: the foreign keys below are
    // created after the tables in one generated migration, and Postgres
    // requires the referenced unique key to exist by then.
    unique('repositories_owner_id_key').on(t.ownerUserId, t.id),
    index('repositories_owner_created_idx').on(t.ownerUserId, t.createdAt),
    pgPolicy('repositories_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

/** A declared alternate remote, so a rename or a fork selects one repository. */
export const repositoryAliases = pgTable(
  'repository_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').notNull(),
    canonicalAlias: text('canonical_alias').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // A declared remote selects at most one repository of that owner.
    uniqueIndex('repository_aliases_owner_alias_uidx').on(
      t.ownerUserId,
      t.canonicalAlias,
    ),
    index('repository_aliases_owner_repository_idx').on(
      t.ownerUserId,
      t.repositoryId,
    ),
    foreignKey({
      name: 'repository_aliases_repository_owner_fk',
      columns: [t.ownerUserId, t.repositoryId],
      foreignColumns: [repositories.ownerUserId, repositories.id],
    }).onDelete('cascade'),
    pgPolicy('repository_aliases_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

/**
 * One repository on one executor, at one canonical path. The stored `path` is
 * the canonical form the executor reports: an absolute host path on the local
 * executor, and the `machine://<name>/<abs path>` locator on a Machine — the
 * same form as `chats.workspace_root`, so a checkout and a binding compare
 * equal as strings.
 */
export const checkouts = pgTable(
  'checkouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').notNull(),
    /** The local native executor id, or `machine:<name>`. */
    executorId: text('executor_id').notNull(),
    path: text('path').notNull(),
    /** `main` or `worktree`; the CHECK below is the closed vocabulary. */
    kind: text('kind').$type<CheckoutKind>().notNull(),
    /** The source `main` row of a worktree; NULL on a main row. */
    parentCheckoutId: uuid('parent_checkout_id'),
    /** NULL for a detached HEAD registration or adoption. */
    branch: text('branch'),
    /** `registered`, `adopted`, or `created`. */
    origin: text('origin').$type<CheckoutOrigin>().notNull(),
    /** Placement override of a `main` row; rejected on a worktree row. */
    worktreeBase: text('worktree_base'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One owner holds a path on an executor once. The owner column is part of
    // the key because the local executor and every Machine are shared by all
    // owners; a global key would turn a second owner's registration into a
    // conflict that also discloses the first owner's path.
    uniqueIndex('checkouts_owner_executor_path_uidx').on(
      t.ownerUserId,
      t.executorId,
      t.path,
    ),
    // Parent key for the worktree self-reference and for leases; a table
    // constraint for the same reason as `repositories_owner_id_key`.
    unique('checkouts_owner_id_key').on(t.ownerUserId, t.id),
    index('checkouts_owner_repository_idx').on(t.ownerUserId, t.repositoryId),
    index('checkouts_owner_parent_idx').on(t.ownerUserId, t.parentCheckoutId),
    check('checkouts_kind_check', sql`${t.kind} IN ('main', 'worktree')`),
    check(
      'checkouts_origin_check',
      sql`${t.origin} IN ('registered', 'adopted', 'created')`,
    ),
    // A worktree names its parent and a main row does not, in both directions.
    check(
      'checkouts_worktree_parent_check',
      sql`(${t.kind} = 'worktree') = (${t.parentCheckoutId} IS NOT NULL)`,
    ),
    // A worktree base directory belongs to a main row only.
    check(
      'checkouts_worktree_base_check',
      sql`${t.kind} = 'main' OR ${t.worktreeBase} IS NULL`,
    ),
    foreignKey({
      name: 'checkouts_repository_owner_fk',
      columns: [t.ownerUserId, t.repositoryId],
      foreignColumns: [repositories.ownerUserId, repositories.id],
    }).onDelete('cascade'),
    // Deleting a main row deletes its worktree rows; the directories stay.
    foreignKey({
      name: 'checkouts_parent_owner_fk',
      columns: [t.ownerUserId, t.parentCheckoutId],
      foreignColumns: [t.ownerUserId, t.id],
    }).onDelete('cascade'),
    pgPolicy('checkouts_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

/**
 * An informational receipt: which chat created a worktree and from which base
 * ref. It refuses nothing — a second chat may bind a leased path, and a fork
 * copies its binding as before — so it needs no key beyond its primary key.
 */
export const worktreeLeases = pgTable(
  'worktree_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').notNull(),
    checkoutId: uuid('checkout_id').notNull(),
    baseRef: text('base_ref').notNull(),
    /**
     * The HEAD of the new worktree, which `git.worktreeAdd` reports and the
     * create result carries as `baseCommit`. The removal guard compares it
     * when a fresh worktree has no upstream, so a receipt without one could
     * not prove the branch holds no unpushed commit.
     */
    baseCommit: text('base_commit').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('worktree_leases_owner_checkout_idx').on(t.ownerUserId, t.checkoutId),
    index('worktree_leases_owner_chat_idx').on(t.ownerUserId, t.chatId),
    foreignKey({
      name: 'worktree_leases_checkout_owner_fk',
      columns: [t.ownerUserId, t.checkoutId],
      foreignColumns: [checkouts.ownerUserId, checkouts.id],
    }).onDelete('cascade'),
    // Column order follows `chats_id_owner_user_id_unique_idx`, the unique key
    // this foreign key references; the owner match is the same.
    foreignKey({
      name: 'worktree_leases_chat_owner_fk',
      columns: [t.chatId, t.ownerUserId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }).onDelete('cascade'),
    pgPolicy('worktree_leases_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Repository = InferSelectModel<typeof repositories>;
export type RepositoryAlias = InferSelectModel<typeof repositoryAliases>;
export type Checkout = InferSelectModel<typeof checkouts>;
export type WorktreeLease = InferSelectModel<typeof worktreeLeases>;
