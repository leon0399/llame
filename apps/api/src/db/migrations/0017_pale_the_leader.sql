CREATE TYPE "public"."approval_level" AS ENUM('always_ask', 'ask_once_per_run', 'ask_once_per_chat', 'ask_once_per_project', 'auto_allow_readonly', 'auto_allow_low_risk', 'admin_only');--> statement-breakpoint
CREATE TYPE "public"."policy_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."policy_scope_type" AS ENUM('org_unit', 'user', 'chat');--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" "policy_scope_type" NOT NULL,
	"scope_id" text NOT NULL,
	"effect" "policy_effect" NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"conditions" jsonb,
	"approval" "approval_level",
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"effect" "policy_effect" NOT NULL,
	"approval" "approval_level",
	"matched" jsonb,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "policies_scope_idx" ON "policies" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "policies_action_idx" ON "policies" USING btree ("action");--> statement-breakpoint
CREATE INDEX "policy_decisions_user_created_idx" ON "policy_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "policies_select" ON "policies" AS PERMISSIVE FOR SELECT TO public USING ((
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
      ));--> statement-breakpoint
CREATE POLICY "policies_write" ON "policies" AS PERMISSIVE FOR ALL TO public USING ((
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
  )) WITH CHECK ((
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
  ));--> statement-breakpoint
CREATE POLICY "policy_decisions_owner" ON "policy_decisions" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_decisions" FORCE ROW LEVEL SECURITY;