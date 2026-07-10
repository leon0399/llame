CREATE TYPE "public"."config_scope_type" AS ENUM('org_unit', 'user', 'chat');--> statement-breakpoint
CREATE TABLE "configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" "config_scope_type" NOT NULL,
	"scope_id" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "configs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "config_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "configs_scope_unique" ON "configs" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "configs_scope_id_idx" ON "configs" USING btree ("scope_id");--> statement-breakpoint
CREATE POLICY "configs_select" ON "configs" AS PERMISSIVE FOR SELECT TO public USING ((
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
      ));--> statement-breakpoint
CREATE POLICY "configs_write" ON "configs" AS PERMISSIVE FOR ALL TO public USING ((
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
  )) WITH CHECK ((
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
  ));