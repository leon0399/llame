import { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { users } from './auth';

// A project: a terminal, user-owned chat group (projects-foundation). Its own
// table — NOT an org_unit_type — because it is user-ownable and terminal.
// Owner-only until the membership+sharing change; org ownership is a later
// additive arm (owner_org_unit_id), mirroring chats' single-owner-then-org
// precedent (chats.ts:23-24). FORCE ROW LEVEL SECURITY is hand-appended in the
// migration (Drizzle emits ENABLE only) — see the migration this generates.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text — FK to users.id which is text (NextAuth convention).
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Owner-authored prose about what the project is for.
    // Nullable, never defaulted: a project starts with no description, and the
    // owner sets or clears it through PATCH /api/v1/projects/:id — creation
    // takes a name only.
    description: text('description'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    // Archive state (chat-project-archive): a nullable timestamp on the row, so
    // archiving is a global, owner-scoped action (unlike the per-user `pins`
    // table). NULL = not archived.
    archivedAt: timestamptz('archived_at'),
    // The executor a chat start on this project prefers when no link default
    // names one (chat-start-location D8). Nullable, and deliberately without a
    // foreign key to `machines_status`: that table is an observation the hub
    // probe rewrites, while this column is the owner's intent. A configured
    // executor id — `tools.nativeExecutorId` or `machine:<name>` — that the
    // current configuration no longer carries simply resolves nothing.
    defaultExecutorId: text('default_executor_id'),
  },
  (t) => [
    // Mirrors listForUser's ORDER BY exactly (owner, created_at DESC) so the
    // project list is a single ordered index scan instead of scan + sort —
    // same rationale as chats_owner_updated_idx.
    index('projects_owner_created_idx').on(t.ownerUserId, t.createdAt.desc()),
    // Composite for filtered queries: owner + archived state + creation order.
    // Allows ordering by archive state without a separate index pass.
    index('projects_owner_archived_created_idx').on(
      t.ownerUserId,
      t.archivedAt,
      t.createdAt.desc(),
    ),
    // Parent key for every composite owner foreign key that names a project
    // (the project links of `projects` and their defaults of chat-start-location).
    // A table constraint, not an index: the foreign keys are created after the
    // tables in one generated migration, and Postgres requires the referenced
    // unique key to exist then — same rationale as `repositories_owner_id_key`.
    unique('projects_owner_id_key').on(t.ownerUserId, t.id),
    // Owner-only, same shape as chats_owner. Single row-local comparison — no
    // cross-table scan, no recursion, no BYPASSRLS. USING doubles as the
    // INSERT/UPDATE WITH CHECK (Postgres: absent WITH CHECK ⇒ USING is used).
    pgPolicy('projects_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Project = InferSelectModel<typeof projects>;
