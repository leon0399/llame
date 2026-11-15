-- Prepares immutable model-context snapshots for availability authoring.
-- Hand-authored: adds non-null manifest/hash columns with the exact canonical v0
-- {"version":0,"state":"unobserved"} defaults, explicitly backfills that sentinel
-- and its domain hash inside a NO FORCE ROW LEVEL SECURITY window (pattern P2),
-- creates the availability-aware reuse index, and DELIBERATELY RETAINS the
-- legacy reuse index so old writers stay valid. Historical content_hash values
-- are untouched. 20260811084012_thankful_gwen_stacy is the writer cutover that
-- removes the legacy index and the temporary defaults, and must be applied only
-- after old API writers are quiesced.
-- Re-add the defaults, the backfill window, and both-index preparation state if
-- this migration is regenerated.
ALTER TABLE "model_context_snapshots" ADD COLUMN "availability_hash" text DEFAULT '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e';--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ADD COLUMN "tool_availability_manifest" jsonb DEFAULT '{"version":0,"state":"unobserved"}'::jsonb;--> statement-breakpoint
ALTER TABLE "model_context_snapshots" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "model_context_snapshots"
SET "tool_availability_manifest" = '{"version":0,"state":"unobserved"}'::jsonb, "availability_hash" = '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e';--> statement-breakpoint
ALTER TABLE "model_context_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ALTER COLUMN "tool_availability_manifest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ALTER COLUMN "availability_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_context_snapshots_owner_content_avail_source_uidx" ON "model_context_snapshots" USING btree ("owner_user_id","content_hash","availability_hash","source");
