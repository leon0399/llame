ALTER TABLE "org_units" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
-- Hand-appended (admin-area-org-tree D5): drizzle-kit's enum-recreate doesn't
-- account for existing rows holding a value about to be dropped from the
-- vocabulary — the final USING cast below would fail on any 'project'-typed
-- row. Convert strays to 'group' while the column is still plain text, before
-- the new (project-less) enum exists. Runs in the same transaction as the
-- rest of this file, so the conversion and the type swap land atomically.
-- Same NO FORCE window as 0012/0020: migrations run as the owning `app` role
-- with no app.current_user_id, and org_units is FORCE RLS (0018) — without
-- lifting FORCE the UPDATE silently matches zero rows and the USING cast
-- below then aborts on any real stray row. The owner bypasses plain RLS,
-- and no non-migration statement runs inside the window.
ALTER TABLE "org_units" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "org_units" SET "type" = 'group' WHERE "type" = 'project';--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DEFAULT 'group'::text;--> statement-breakpoint
DROP TYPE "public"."org_unit_type";--> statement-breakpoint
CREATE TYPE "public"."org_unit_type" AS ENUM('organization', 'group', 'team', 'department');--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DEFAULT 'group'::"public"."org_unit_type";--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DATA TYPE "public"."org_unit_type" USING "type"::"public"."org_unit_type";