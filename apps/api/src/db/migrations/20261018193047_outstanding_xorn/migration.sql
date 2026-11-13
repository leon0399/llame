CREATE TABLE "machines_status" (
	"name" text PRIMARY KEY NOT NULL,
	"first_contact_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"hub_protocol_version" integer NOT NULL,
	"daemon_protocol_version" integer,
	"daemon_version" text,
	"roots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_status_name_check" CHECK ("machines_status"."name" ~ '^[a-z0-9-]{1,63}$'),
	CONSTRAINT "machines_status_failure_reason_check" CHECK ("machines_status"."last_failure_reason" IS NULL OR "machines_status"."last_failure_reason" IN ('unreachable', 'host_key_mismatch', 'auth_failed', 'incompatible_version', 'session_lost'))
);
--> statement-breakpoint
ALTER TABLE "machines_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "machines_status_authenticated_select" ON "machines_status" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.current_user_id', true) <> '');--> statement-breakpoint
CREATE POLICY "machines_status_system_write" ON "machines_status" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.machines_system', true) = '1') WITH CHECK (current_setting('app.machines_system', true) = '1');--> statement-breakpoint
-- Manual: drizzle-kit emits ENABLE ROW LEVEL SECURITY but cannot express FORCE
-- (db/AGENTS.md P1). FORCE is load-bearing here because the serving role owns
-- this table: without it the hub's own system connection would bypass the
-- authenticated read policy and the marked system-write policy alike.
-- Regeneration must re-append this statement.
ALTER TABLE "machines_status" FORCE ROW LEVEL SECURITY;
