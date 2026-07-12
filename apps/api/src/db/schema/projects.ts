import { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Mirrors listForUser's ORDER BY exactly (owner, created_at DESC) so the
    // project list is a single ordered index scan instead of scan + sort —
    // same rationale as chats_owner_updated_idx.
    index('projects_owner_created_idx').on(t.ownerUserId, t.createdAt.desc()),
    // Owner-only, same shape as chats_owner. Single row-local comparison — no
    // cross-table scan, no recursion, no BYPASSRLS. USING doubles as the
    // INSERT/UPDATE WITH CHECK (Postgres: absent WITH CHECK ⇒ USING is used).
    pgPolicy('projects_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Project = InferSelectModel<typeof projects>;
