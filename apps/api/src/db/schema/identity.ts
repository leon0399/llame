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
const OWNER_ROLE = `'owner'`;

// SQL fragment calling the BYPASSRLS helper (org-units change, D4):
// `llame_role_on_unit_path(unit_id, roles[])` — true when the current user
// holds one of `roles` on the given unit's path. Provisioned as a
// SECURITY DEFINER STABLE function owned by the `app_rls` role (BYPASSRLS;
// docker/postgres/initdb/02-app-rls-role.sql), hand-appended in this
// migration alongside the FORCE statements — Drizzle cannot express
// CREATE FUNCTION/ALTER … OWNER TO any more than it can CREATE ROLE.
//
// Unlike roleInPath (a subquery scanning memberships under the CALLER's own
// RLS), this function reads org_units/memberships with RLS bypassed
// entirely, which is the only way memberships policies can check "member/
// admin on the unit's path" without a self-reference cycle: org_units'
// SELECT policy already scans memberships (roleInPath); a memberships
// policy scanning org_units back — needed for roster visibility and
// admin-on-other-members'-rows ops — would otherwise recurse into org_units'
// policy, which scans memberships again, forever. BYPASSRLS breaks the
// cycle by not going through policy evaluation at all.
const roleOnPath = (unitIdExpr: string, roles: string) =>
  sql.raw(
    `llame_role_on_unit_path(${unitIdExpr}, ARRAY[${roles}]::org_role[])`,
  );

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
    // Per-node settings (SPEC §7.2); the config resolver (#46) reads these.
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    // D1: the deferred path-integrity constraint trigger reads the parent
    // row (to check the new/updated row's path against the parent's CURRENT
    // path) from inside a trigger body, which runs under the writer's own
    // RLS context. A permissive policy scoped to `pg_trigger_depth() > 0` —
    // true only while executing inside a trigger — widens reads to
    // schema-owned trigger code, not to callers. Reviewed like a migration,
    // same trust boundary as the trigger function itself.
    pgPolicy('org_units_trigger_read', {
      for: 'select',
      using: sql`pg_trigger_depth() > 0`,
    }),
    // Anyone may create a ROOT unit (self-hosted: creating your household/org;
    // instance-level restriction is #45 policy territory). A CHILD requires
    // owner/admin on an ancestor — checked against the NEW row's path, which
    // embeds every ancestor id. created_by must be the caller (no forging).
    // Path/parent consistency (path = parent.path || '/' || id) is computed by
    // the repository and independently re-checked by the `org_units_path_integrity`
    // deferred constraint trigger (migration 0019); the admin surface lives at
    // `IdentityController` (`api/v1/org-units`).
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
    // Read: own rows, OR any member on the unit's path — roster visibility
    // (org-units change, D4; GitHub-org model: any member sees who else is
    // in scope). The path-role check goes through the BYPASSRLS function,
    // not a raw subquery on org_units — a raw scan here would recurse
    // (org_units' SELECT policy scans memberships; this policy scanning
    // org_units back would close the cycle). Per-unit roster privacy is
    // policy-engine (#45) territory.
    pgPolicy('memberships_select', {
      for: 'select',
      using: sql`user_id = ${currentUser} OR ${roleOnPath('memberships.org_unit_id', ANY_ROLE)}`,
    }),
    // D1: lets the path-integrity trigger (and this table's own last-owner
    // trigger) read sibling/other rows from inside a trigger body. Same
    // rationale as org_units_trigger_read.
    pgPolicy('memberships_trigger_read', {
      for: 'select',
      using: sql`pg_trigger_depth() > 0`,
    }),
    // Grant paths (org-units change, D3 adds the owner-tier branch):
    // (a) bootstrap — the creator of a ROOT unit grants THEMSELVES 'owner'
    // on it (raw org_units EXISTS is safe here, not the function: nothing
    // is granted on the path yet for the function to find, and this branch
    // scans org_units directly rather than via memberships, same
    // non-recursive shape as before);
    // (b) owner-tier — an existing OWNER anywhere on the path may grant or
    // set ANY role, including 'owner' (co-ownership / transfer, D3);
    // (c) admin-tier — owner/admin on the path may grant anything EXCEPT
    // 'owner'. This is the datastore backstop for the app-code guard
    // (GrantMembershipDto's role enum): owner is mintable ONLY via (a) or
    // (b), so admins can't mint a second owner through this branch even via
    // direct SQL. Defense-in-depth, not a substitute for #45
    // (deny-overrides-allow) — see roleInPath's doc.
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
      ) OR (
        llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])
      ) OR (
        memberships.role <> 'owner'
        AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[])
      )`),
    }),
    // Role changes (D3, tightened by review finding F1): USING decides which
    // EXISTING rows an admin-or-owner may touch AT ALL — an admin may touch
    // a non-owner row, but ONLY an owner-tier caller may touch a row that is
    // CURRENTLY 'owner' (USING sees the OLD row, unlike WITH CHECK, which
    // sees the NEW one) — otherwise an admin could "change the role to
    // member" on an existing owner and demote them without ever holding
    // owner-tier themselves. WITH CHECK then decides what they may set the
    // role TO: admins may set anything except 'owner'; only an owner-tier
    // caller may set (or keep) 'owner' — the same backstop as the insert
    // policy's branch (c).
    pgPolicy('memberships_update', {
      for: 'update',
      using: sql`(
        memberships.role <> 'owner' AND ${roleOnPath('memberships.org_unit_id', ADMIN_ROLES)}
      ) OR ${roleOnPath('memberships.org_unit_id', OWNER_ROLE)}`,
      withCheck: sql`(
        memberships.role <> 'owner' AND ${roleOnPath('memberships.org_unit_id', ADMIN_ROLES)}
      ) OR (
        memberships.role = 'owner' AND ${roleOnPath('memberships.org_unit_id', OWNER_ROLE)}
      )`,
    }),
    // Revoke (tightened by review finding F1, same shape as update): self
    // (leaving, any role — the D2 trigger is what actually guards a sole
    // owner leaving, not this policy), OR admin-tier revoking a NON-owner
    // row, OR owner-tier revoking ANY row including another owner's.
    // Without the owner-tier branch's OLD-row check, an admin could revoke
    // an existing co-owner (a different row than their own) while another
    // owner remains, without ever holding owner-tier themselves — the D2
    // trigger only guards against removing the LAST owner, not against WHO
    // may remove a non-last one.
    pgPolicy('memberships_delete', {
      for: 'delete',
      using: sql`
        user_id = ${currentUser}
        OR (memberships.role <> 'owner' AND ${roleOnPath('memberships.org_unit_id', ADMIN_ROLES)})
        OR ${roleOnPath('memberships.org_unit_id', OWNER_ROLE)}
      `,
    }),
  ],
).enableRLS();

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
