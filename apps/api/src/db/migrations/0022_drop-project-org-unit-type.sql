ALTER TABLE "org_units" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
-- Hand-appended (admin-area-org-tree D5): drizzle-kit's enum-recreate doesn't
-- account for existing rows holding a value about to be dropped from the
-- vocabulary — the final USING cast below would fail on any 'project'-typed
-- row. Convert strays to 'group' while the column is still plain text, before
-- the new (project-less) enum exists. Runs in the same transaction as the
-- rest of this file, so the conversion and the type swap land atomically.
UPDATE "org_units" SET "type" = 'group' WHERE "type" = 'project';--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DEFAULT 'group'::text;--> statement-breakpoint
DROP TYPE "public"."org_unit_type";--> statement-breakpoint
CREATE TYPE "public"."org_unit_type" AS ENUM('organization', 'group', 'team', 'department');--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DEFAULT 'group'::"public"."org_unit_type";--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "type" SET DATA TYPE "public"."org_unit_type" USING "type"::"public"."org_unit_type";