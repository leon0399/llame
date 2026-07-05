import { InferSelectModel, sql } from 'drizzle-orm';
import {
  bigint,
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

// Scopes that can SET config values (#46, SPEC §6.3). The instance layer is
// deliberately absent: instance defaults come from environment variables until
// an instance-admin surface exists — a configs row nobody can write would be
// dead weight. Project/command scopes join with their milestones (v0.5+).
export const configScopeType = pgEnum('config_scope_type', [
  'org_unit',
  'user',
  'chat',
]);

/**
 * One config document per scope instance (#46, SPEC §6.3). `version`
 * increments on every write — the run snapshot records which version of each
 * layer it was computed from, which is what makes "why did this run behave
 * that way?" answerable after the config has changed.
 */
export const configs = pgTable(
  'configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeType: configScopeType('scope_type').notNull(),
    // org_unit/chat ids are uuids, user ids are text — text covers all three;
    // policies cast where needed.
    scopeId: text('scope_id').notNull(),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('configs_scope_unique').on(t.scopeType, t.scopeId),
    index('configs_scope_id_idx').on(t.scopeId),
    // RLS (FORCE hand-appended in the migration). Read/write follow the scope:
    //  - user:     own scope only
    //  - chat:     the chat's owner (chats policy chain is terminal)
    //  - org_unit: read = the config BINDS you (the scope unit is an
    //              ancestor-or-self of one of your units — tested against
    //              YOUR unit's path, since ancestors themselves are invisible
    //              to descendants) or sits inside a subtree you belong to;
    //              write = owner/admin on the unit or an ancestor. Same
    //              shape as the policies table (#45), where the too-narrow
    //              read arm was caught making ancestor governance fail open.
    pgPolicy('configs_select', {
      for: 'select',
      using: sql.raw(`(
        (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
        OR (scope_type = 'chat' AND EXISTS (
          SELECT 1 FROM chats c
          WHERE c.id::text = configs.scope_id
            AND c.owner_user_id = current_setting('app.current_user_id', true)
        ))
        OR (scope_type = 'org_unit' AND (
          EXISTS (
            SELECT 1 FROM memberships m
            JOIN org_units mu ON mu.id = m.org_unit_id
            WHERE m.user_id = current_setting('app.current_user_id', true)
              AND configs.scope_id = ANY(string_to_array(mu.path, '/'))
          )
          OR EXISTS (
            SELECT 1 FROM org_units u
            WHERE u.id::text = configs.scope_id
              AND EXISTS (
                SELECT 1 FROM memberships m2
                WHERE m2.user_id = current_setting('app.current_user_id', true)
                  AND m2.org_unit_id::text = ANY(string_to_array(u.path, '/'))
              )
          )
        ))
      )`),
    }),
    pgPolicy('configs_write', {
      for: 'all',
      using: writeClause(),
      withCheck: writeClause(),
    }),
  ],
).enableRLS();

/** Write access: own user/chat scope; owner/admin on the org-unit scope. */
function writeClause() {
  return sql.raw(`(
    (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
    OR (scope_type = 'chat' AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id::text = configs.scope_id
        AND c.owner_user_id = current_setting('app.current_user_id', true)
    ))
    OR (scope_type = 'org_unit' AND EXISTS (
      SELECT 1 FROM org_units u
      WHERE u.id::text = configs.scope_id
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = current_setting('app.current_user_id', true)
            AND m.role IN ('owner','admin')
            AND m.org_unit_id::text = ANY(string_to_array(u.path, '/'))
        )
    ))
  )`);
}

export type ConfigRow = InferSelectModel<typeof configs>;
export type ConfigScopeType = (typeof configScopeType.enumValues)[number];
