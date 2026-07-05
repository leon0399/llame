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
  uuid,
} from 'drizzle-orm/pg-core';

export const policyEffect = pgEnum('policy_effect', ['allow', 'deny']);

// SPEC §7.5 approval vocabulary. Attached to ALLOW policies: "you may, but…".
// `never_allowed` deliberately absent — that is what a deny policy IS.
export const approvalLevel = pgEnum('approval_level', [
  'always_ask',
  'ask_once_per_run',
  'ask_once_per_chat',
  'ask_once_per_project',
  'auto_allow_readonly',
  'auto_allow_low_risk',
  'admin_only',
]);

// Policies attach to the same scope chain as configs (#46). The instance
// layer is again deliberately absent until an instance-admin surface exists.
export const policyScopeType = pgEnum('policy_scope_type', [
  'org_unit',
  'user',
  'chat',
]);

/**
 * RBAC/ABAC policy rows (#45, SPEC §7.4): `effect` on `action` (dotted verb,
 * e.g. connector.invoke, sandbox.execute; '*' wildcard suffix supported by
 * the evaluator) for an optional resource, under optional jsonb conditions
 * (equality-matched against the check context — ALL must hold). `version`
 * bumps on every write so a decision can record exactly which policy
 * versions produced it.
 */
export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeType: policyScopeType('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    effect: policyEffect('effect').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    conditions: jsonb('conditions'),
    // Approval demanded when this ALLOW matches (null = no approval needed).
    // Meaningless on deny rows; the evaluator ignores it there.
    approval: approvalLevel('approval'),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('policies_scope_idx').on(t.scopeType, t.scopeId),
    index('policies_action_idx').on(t.action),
    // RLS (FORCE hand-appended in the migration). READ is deliberately wider
    // than the configs shape (#46): a policy that BINDS you must be READABLE
    // by you, or the evaluator (running as the actor) cannot enforce an
    // ancestor's deny — fail-open, caught by the integration suite. The org
    // arm therefore admits members of the scope unit's subtree (the policy
    // governs them) as well as members of its ancestors.
    pgPolicy('policies_select', {
      for: 'select',
      using: sql.raw(`(
        (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
        OR (scope_type = 'chat' AND EXISTS (
          SELECT 1 FROM chats c
          WHERE c.id::text = policies.scope_id
            AND c.owner_user_id = current_setting('app.current_user_id', true)
        ))
        OR (scope_type = 'org_unit' AND (
          EXISTS (
            SELECT 1 FROM memberships m
            JOIN org_units mu ON mu.id = m.org_unit_id
            WHERE m.user_id = current_setting('app.current_user_id', true)
              AND policies.scope_id = ANY(string_to_array(mu.path, '/'))
          )
          OR EXISTS (
            SELECT 1 FROM org_units u
            WHERE u.id::text = policies.scope_id
              AND EXISTS (
                SELECT 1 FROM memberships m2
                WHERE m2.user_id = current_setting('app.current_user_id', true)
                  AND m2.org_unit_id::text = ANY(string_to_array(u.path, '/'))
              )
          )
        ))
      )`),
    }),
    // WRITE stays narrow: own user/chat scope; owner-admin on the scope unit
    // or an ancestor for org scope (a descendant cannot rewrite the policy
    // that binds them).
    pgPolicy('policies_write', {
      for: 'all',
      using: policyWriteClause(),
      withCheck: policyWriteClause(),
    }),
  ],
).enableRLS();

function policyWriteClause() {
  return sql.raw(`(
    (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
    OR (scope_type = 'chat' AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id::text = policies.scope_id
        AND c.owner_user_id = current_setting('app.current_user_id', true)
    ))
    OR (scope_type = 'org_unit' AND EXISTS (
      SELECT 1 FROM org_units u
      WHERE u.id::text = policies.scope_id
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = current_setting('app.current_user_id', true)
            AND m.role IN ('owner','admin')
            AND m.org_unit_id::text = ANY(string_to_array(u.path, '/'))
        )
    ))
  )`);
}

export type Policy = InferSelectModel<typeof policies>;
export type PolicyEffect = (typeof policyEffect.enumValues)[number];
export type ApprovalLevel = (typeof approvalLevel.enumValues)[number];
export type PolicyScopeType = (typeof policyScopeType.enumValues)[number];

/**
 * Append-only decision audit log (#45, SPEC §7.4 "policy decisions are
 * logged" / §29.2). Records what was asked, what was decided, and exactly
 * which policy versions matched. No update/delete surface, mirrors
 * run_events. Own-rows-only visibility.
 */
export const policyDecisions = pgTable(
  'policy_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    effect: policyEffect('effect').notNull(),
    approval: approvalLevel('approval'),
    // [{ policyId, version, scopeType, scopeId, effect }] — the audit trail.
    matched: jsonb('matched'),
    context: jsonb('context'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('policy_decisions_user_created_idx').on(t.userId, t.createdAt),
    pgPolicy('policy_decisions_owner', {
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type PolicyDecisionRow = InferSelectModel<typeof policyDecisions>;
