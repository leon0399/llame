import { InferSelectModel, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

// Node flavors (SPEC §7.2): the tree is behavior-uniform in v0.3 — `type` is
// presentation/semantics for later milestones (projects become richer in
// v0.5). DB-enforced like the other enums; adding a value is an additive
// ALTER TYPE migration.
export const orgUnitType = pgEnum('org_unit_type', [
  'organization',
  'group',
  'team',
  'department',
  'project',
]);

// Full SPEC §7.3 role vocabulary, DB-enforced.
export const orgRole = pgEnum('org_role', [
  'owner',
  'admin',
  'maintainer',
  'member',
  'viewer',
  'guest',
  'service_account',
]);

/** current_setting shorthand used by every policy below. */
const currentUser = sql.raw(`current_setting('app.current_user_id', true)`);

// SQL fragment: the current user holds one of `roles` on the given unit or any
// of its ancestors. The id-based materialized path makes this a single
// memberships scan: a path is exactly the list of ancestor ids + self, so
// "membership on an ancestor" is `org_unit_id = ANY(string_to_array(path))`.
// Deliberately NO org_units self-join here — a policy on org_units that scans
// org_units is infinite RLS recursion, which Postgres rejects.
const roleInPath = (pathExpr: string, roles: string) =>
  sql.raw(`EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN (${roles})
      AND m.org_unit_id::text = ANY(string_to_array(${pathExpr}, '/'))
  )`);

const ANY_ROLE = `'owner','admin','maintainer','member','viewer','guest','service_account'`;
const ADMIN_ROLES = `'owner','admin'`;

// A nested org unit (#44, SPEC §6.1/§7.2): organization → team → … arbitrary
// nesting via parent_id, with an id-based materialized `path` for fast
// subtree/ancestor queries (`root_id/child_id/grandchild_id`). Ids — not
// names/slugs — so a rename never rebuilds paths; only a move rewrites the
// subtree. `path` for a root is its own id.
export const orgUnits = pgTable(
  'org_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict — deleting a node with children must be explicit (leaf-up), not
    // a silent cascade of an entire subtree.
    parentId: uuid('parent_id').references((): AnyPgColumn => orgUnits.id, {
      onDelete: 'restrict',
    }),
    type: orgUnitType('type').notNull().default('group'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    // Bootstrap + audit (see policies): the creating user. Nullable because a
    // deleted user anonymizes, not blocks (matches messages.senderUserId).
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Per-node settings (SPEC §7.2) live in the `configs` table (#46,
    // uniform versioned scope config) — not as a column here.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('org_units_path_unique').on(t.path),
    index('org_units_parent_idx').on(t.parentId),
    // RLS (FORCE hand-appended in the migration, like 0004/0009/0010 — Drizzle
    // cannot express FORCE). Visibility = membership on the unit or any
    // ancestor, plus creator visibility — the bootstrap edge: a freshly
    // created root has no memberships yet, and its creator must be able to
    // see it to grant themselves the owner membership in the same tx.
    pgPolicy('org_units_select', {
      for: 'select',
      using: sql`${roleInPath('org_units.path', ANY_ROLE)} OR created_by = ${currentUser}`,
    }),
    // Anyone may create a ROOT unit (self-hosted: creating your household/org;
    // instance-level restriction is #45 policy territory). A CHILD requires
    // owner/admin on an ancestor — checked against the NEW row's path, which
    // embeds every ancestor id. created_by must be the caller (no forging).
    // Path/parent consistency (path = parent.path || '/' || id) is computed by
    // the repository; a DB integrity trigger is deferred to the CRUD-surface
    // slice — there is no HTTP surface for org_units yet.
    pgPolicy('org_units_insert', {
      for: 'insert',
      withCheck: sql`created_by = ${currentUser} AND (parent_id IS NULL OR ${roleInPath('org_units.path', ADMIN_ROLES)})`,
    }),
    pgPolicy('org_units_update', {
      for: 'update',
      using: roleInPath('org_units.path', ADMIN_ROLES),
      withCheck: roleInPath('org_units.path', ADMIN_ROLES),
    }),
    // Destructive → owner only (SPEC §7.3 role examples).
    pgPolicy('org_units_delete', {
      for: 'delete',
      using: roleInPath('org_units.path', `'owner'`),
    }),
  ],
).enableRLS();

export type OrgUnit = InferSelectModel<typeof orgUnits>;
export type OrgUnitType = (typeof orgUnitType.enumValues)[number];
export type OrgRole = (typeof orgRole.enumValues)[number];

// Explicit memberships (#44, SPEC §7.2): one row per (user, org unit).
// Inherited memberships are NOT materialized — resolution walks the ancestor
// path at read time (IdentityService), so a subtree move never rewrites
// membership rows and there is no fan-out to maintain.
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_user_unit_unique').on(t.userId, t.orgUnitId),
    index('memberships_unit_idx').on(t.orgUnitId),
    // Read: own rows only — deliberately narrow (fail closed). Member LISTS
    // (seeing others in your org) arrive with the admin surface + policy
    // engine (#45). Keeping this policy free of org_units references also
    // keeps it the terminal leaf of every policy chain: org_units policies
    // scan memberships, so this one must not scan org_units back (RLS
    // rewriter cycle = error).
    pgPolicy('memberships_select', {
      for: 'select',
      using: sql`user_id = ${currentUser}`,
    }),
    // Grant paths: (a) bootstrap — the creator of a ROOT unit grants
    // THEMSELVES 'owner' on it (org_units scan is safe here: its select
    // policy only scans memberships, whose select policy is terminal);
    // (b) an owner/admin on the target's ancestor path grants anyone.
    pgPolicy('memberships_insert', {
      for: 'insert',
      withCheck: sql.raw(`(
        user_id = current_setting('app.current_user_id', true)
        AND role = 'owner'
        AND EXISTS (
          SELECT 1 FROM org_units u
          WHERE u.id = memberships.org_unit_id
            AND u.parent_id IS NULL
            AND u.created_by = current_setting('app.current_user_id', true)
        )
      ) OR EXISTS (
        SELECT 1 FROM org_units u
        WHERE u.id = memberships.org_unit_id
          AND EXISTS (
            SELECT 1 FROM memberships granter
            WHERE granter.user_id = current_setting('app.current_user_id', true)
              AND granter.role IN ('owner','admin')
              AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
          )
      )`),
    }),
    // Role changes: ancestor owner/admin only.
    pgPolicy('memberships_update', {
      for: 'update',
      using: adminOnMembershipUnit(),
      withCheck: adminOnMembershipUnit(),
    }),
    // Revoke: ancestor owner/admin, or yourself (leaving). Last-owner
    // protection is service-layer (#45 policy engine) territory.
    pgPolicy('memberships_delete', {
      for: 'delete',
      using: sql`user_id = ${currentUser} OR ${adminOnMembershipUnit()}`,
    }),
  ],
).enableRLS();

/** The current user is owner/admin on the membership's unit or an ancestor. */
function adminOnMembershipUnit() {
  return sql.raw(`EXISTS (
    SELECT 1 FROM org_units u
    WHERE u.id = memberships.org_unit_id
      AND EXISTS (
        SELECT 1 FROM memberships granter
        WHERE granter.user_id = current_setting('app.current_user_id', true)
          AND granter.role IN ('owner','admin')
          AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
      )
  )`);
}

export type Membership = InferSelectModel<typeof memberships>;

// Canonical external identity map (#44, SPEC §7.1/§19.2): (provider,
// external_subject) → one llame user. This is what lets the same person be
// one account across web, Telegram, Discord, … Designed fresh — reference
// research (Hermes) confirmed no OSS comp actually solves this. Distinct from
// NextAuth's `accounts` table, which is web-OAuth login plumbing only.
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // e.g. 'telegram', 'discord', 'oidc:<issuer>'
    provider: text('provider').notNull(),
    // The provider's stable subject for this person (chat user id, sub claim).
    externalSubject: text('external_subject').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('external_identities_provider_subject_unique').on(
      t.provider,
      t.externalSubject,
    ),
    index('external_identities_user_idx').on(t.userId),
    // Own rows only. Channel ingress (v0.9) resolves identities via a
    // dedicated service context, not a user session.
    pgPolicy('external_identities_owner', {
      using: sql`user_id = ${currentUser}`,
    }),
  ],
).enableRLS();

export type ExternalIdentity = InferSelectModel<typeof externalIdentities>;
