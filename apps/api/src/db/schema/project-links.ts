import { InferSelectModel, sql } from 'drizzle-orm';
import {
  boolean,
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
import { projects } from './projects';
import { repositories } from './repositories';

/**
 * The repositories a project links (openspec `projects`: "A project links
 * repositories with an alias and a primary link").
 *
 * The table is owner-scoped. The row carries `owner_user_id` for the composite
 * owner foreign keys, and the policy admits a row only when the caller can read
 * its parent — the same shape as the chats file gate (`chats_owner`), because a
 * link exists only relative to a project. A foreign-key check and a cascade both
 * bypass RLS, so every parent reference is composite
 * `(owner_user_id, parent_id)`: a single-column key would let one owner's row
 * name another owner's project or repository, and a parent delete would then
 * cascade across owners. Each parent carries a unique `(owner_user_id, id)`
 * key — `projects` gains one in this change, and `repositories` already
 * declares its own.
 *
 * `ON DELETE CASCADE` is defined only on those composite edges, so a deleted
 * project, repository, or link removes the rows that name it and never a
 * directory or a file. `FORCE ROW LEVEL SECURITY` is hand-appended in the
 * migration — Drizzle emits `ENABLE` only (`apps/api/src/db/AGENTS.md` P1).
 */

// The link's isolation policy vocabulary, mirrored by
// `project_repositories_isolation_check`. Runtime values, because the DTO
// validation, the OpenAPI enum, and the service all name the same three.
export const PROJECT_REPOSITORY_ISOLATIONS = [
  'inherit',
  'always_worktree',
  'never',
] as const;

export type ProjectRepositoryIsolation =
  (typeof PROJECT_REPOSITORY_ISOLATIONS)[number];

/**
 * One repository linked to one project. The alias is the project-scoped name
 * the composer shows; it is stored, not derived, so a rename of the catalog
 * entry leaves the project's label alone.
 */
export const projectRepositories = pgTable(
  'project_repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    repositoryId: uuid('repository_id').notNull(),
    alias: text('alias').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isolation: text('isolation')
      .$type<ProjectRepositoryIsolation>()
      .notNull()
      .default('inherit'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One repository is linked to one project once. The owner column is part of
    // the key for the same reason as the checkout key: a project id is shared
    // by no two owners, but keeping the owner in every key is the rule.
    uniqueIndex('project_repositories_owner_project_repository_uidx').on(
      t.ownerUserId,
      t.projectId,
      t.repositoryId,
    ),
    // At most one primary link per project. A partial unique index, so the
    // non-primary rows are unconstrained; the writer clears the previous
    // primary in the same transaction that sets the new one.
    uniqueIndex('project_repositories_owner_project_primary_uidx')
      .on(t.ownerUserId, t.projectId)
      .where(sql`${t.isPrimary}`),
    // Composite owner key. A table constraint, not an index: it is what a
    // foreign key can name, and keeping the owner in every key is the rule.
    unique('project_repositories_owner_id_key').on(t.ownerUserId, t.id),
    index('project_repositories_owner_project_idx').on(
      t.ownerUserId,
      t.projectId,
    ),
    index('project_repositories_owner_repository_idx').on(
      t.ownerUserId,
      t.repositoryId,
    ),
    check(
      'project_repositories_isolation_check',
      sql`${t.isolation} IN ('inherit', 'always_worktree', 'never')`,
    ),
    foreignKey({
      name: 'project_repositories_project_owner_fk',
      columns: [t.ownerUserId, t.projectId],
      foreignColumns: [projects.ownerUserId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_repositories_repository_owner_fk',
      columns: [t.ownerUserId, t.repositoryId],
      foreignColumns: [repositories.ownerUserId, repositories.id],
    }).onDelete('cascade'),
    // A link is visible only through a project the caller owns. The project
    // subquery runs under `projects_owner` RLS, so it yields the caller's own
    // project ids; a link read or write for another owner therefore matches no
    // row. The explicit owner comparison keeps the row-local assertion even if
    // the projects policy ever widens.
    pgPolicy('project_repositories_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true) AND project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true))`,
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true) AND project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true))`,
    }),
  ],
).enableRLS();

export type ProjectRepository = InferSelectModel<typeof projectRepositories>;
