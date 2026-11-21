CREATE TABLE "machine_bindings" (
	"name" text PRIMARY KEY,
	"instance_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_bindings_name_check" CHECK ("name" ~ '^[a-z0-9-]{1,63}$')
);
--> statement-breakpoint
ALTER TABLE "machine_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "machines_status" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "machines_status" ADD COLUMN "facts_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "machines_status" DROP CONSTRAINT "machines_status_failure_reason_check", ADD CONSTRAINT "machines_status_failure_reason_check" CHECK ("last_failure_reason" IS NULL OR "last_failure_reason" IN ('unreachable', 'host_key_mismatch', 'auth_failed', 'incompatible_version', 'session_lost', 'identity_mismatch'));--> statement-breakpoint
CREATE POLICY "machine_bindings_system_write" ON "machine_bindings" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.machines_system', true) = '1') WITH CHECK (current_setting('app.machines_system', true) = '1');--> statement-breakpoint
-- Manual: drizzle-kit emits ENABLE ROW LEVEL SECURITY but cannot express FORCE
-- (db/AGENTS.md P1). FORCE is load-bearing here because the serving role owns
-- this table: without it the hub's own system connection would bypass the
-- system-write policy, so an unmarked statement could bind or forget an
-- instance id. Regeneration must re-append this statement.
ALTER TABLE "machine_bindings" FORCE ROW LEVEL SECURITY;
