-- Extends knowledge_spaces in place: `Personal` name backfill, millisecond
-- timestamps, owner/creation keyset index, and drops the retired owner
-- uniqueness constraint. Otherwise Drizzle-generated, then hand-appends
-- ENABLE + FORCE ROW LEVEL SECURITY to keep the invariant explicit across
-- upgrade paths (pattern P1).
-- ROLLOUT: deploy the multiple-kb/compat writer to every provisioning API
-- replica and let older requests finish before applying. That compatibility
-- release is then the rollback floor — older targeted ON CONFLICT
-- (owner_user_id) writers fail once the unique arbiter is gone. No Run drain
-- required. Re-add the RLS statements if this migration is regenerated.
ALTER TABLE "knowledge_spaces" DROP CONSTRAINT "knowledge_spaces_owner_user_id_unique";--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD COLUMN "name" text DEFAULT 'Personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD COLUMN "created_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_spaces_owner_created_id_idx" ON "knowledge_spaces" USING btree ("owner_user_id","created_at","knowledge_space_id");
--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_spaces" FORCE ROW LEVEL SECURITY;
