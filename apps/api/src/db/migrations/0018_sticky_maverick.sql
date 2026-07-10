CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'maintainer', 'member', 'viewer', 'guest', 'service_account');--> statement-breakpoint
CREATE TYPE "public"."org_unit_type" AS ENUM('organization', 'group', 'team', 'department', 'project');--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_subject" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"type" "org_unit_type" DEFAULT 'group' NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"created_by" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_unique" ON "external_identities" USING btree ("provider","external_subject");--> statement-breakpoint
CREATE INDEX "external_identities_user_idx" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_unit_unique" ON "memberships" USING btree ("user_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "memberships_unit_idx" ON "memberships" USING btree ("org_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_path_unique" ON "org_units" USING btree ("path");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE POLICY "external_identities_owner" ON "external_identities" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "memberships_insert" ON "memberships" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((
        user_id = current_setting('app.current_user_id', true)
        AND role = 'owner'
        AND EXISTS (
          SELECT 1 FROM org_units u
          WHERE u.id = memberships.org_unit_id
            AND u.parent_id IS NULL
            AND u.created_by = current_setting('app.current_user_id', true)
        )
      ) OR (
        memberships.role <> 'owner'
        AND EXISTS (
          SELECT 1 FROM org_units u
          WHERE u.id = memberships.org_unit_id
            AND EXISTS (
              SELECT 1 FROM memberships granter
              WHERE granter.user_id = current_setting('app.current_user_id', true)
                AND granter.role IN ('owner','admin')
                AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
            )
        )
      ));--> statement-breakpoint
CREATE POLICY "memberships_update" ON "memberships" AS PERMISSIVE FOR UPDATE TO public USING (EXISTS (
    SELECT 1 FROM org_units u
    WHERE u.id = memberships.org_unit_id
      AND EXISTS (
        SELECT 1 FROM memberships granter
        WHERE granter.user_id = current_setting('app.current_user_id', true)
          AND granter.role IN ('owner','admin')
          AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
      )
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM org_units u
    WHERE u.id = memberships.org_unit_id
      AND EXISTS (
        SELECT 1 FROM memberships granter
        WHERE granter.user_id = current_setting('app.current_user_id', true)
          AND granter.role IN ('owner','admin')
          AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
      )
  ) AND role <> 'owner');--> statement-breakpoint
CREATE POLICY "memberships_delete" ON "memberships" AS PERMISSIVE FOR DELETE TO public USING (user_id = current_setting('app.current_user_id', true) OR EXISTS (
    SELECT 1 FROM org_units u
    WHERE u.id = memberships.org_unit_id
      AND EXISTS (
        SELECT 1 FROM memberships granter
        WHERE granter.user_id = current_setting('app.current_user_id', true)
          AND granter.role IN ('owner','admin')
          AND granter.org_unit_id::text = ANY(string_to_array(u.path, '/'))
      )
  ));--> statement-breakpoint
CREATE POLICY "org_units_select" ON "org_units" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN ('owner','admin','maintainer','member','viewer','guest','service_account')
      AND m.org_unit_id::text = ANY(string_to_array(org_units.path, '/'))
  ) OR created_by = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "org_units_insert" ON "org_units" AS PERMISSIVE FOR INSERT TO public WITH CHECK (created_by = current_setting('app.current_user_id', true) AND (parent_id IS NULL OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN ('owner','admin')
      AND m.org_unit_id::text = ANY(string_to_array(org_units.path, '/'))
  )));--> statement-breakpoint
CREATE POLICY "org_units_update" ON "org_units" AS PERMISSIVE FOR UPDATE TO public USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN ('owner','admin')
      AND m.org_unit_id::text = ANY(string_to_array(org_units.path, '/'))
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN ('owner','admin')
      AND m.org_unit_id::text = ANY(string_to_array(org_units.path, '/'))
  ));--> statement-breakpoint
CREATE POLICY "org_units_delete" ON "org_units" AS PERMISSIVE FOR DELETE TO public USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = current_setting('app.current_user_id', true)
      AND m.role IN ('owner')
      AND m.org_unit_id::text = ANY(string_to_array(org_units.path, '/'))
  ));--> statement-breakpoint
-- Hand-maintained (like 0004/0009/0011): Drizzle's .enableRLS() emits ENABLE only. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_identities" FORCE ROW LEVEL SECURITY;