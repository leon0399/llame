-- Media store tables (vision-media D1). This file is generated except for the
-- final two FORCE statements: drizzle-kit emits ENABLE but cannot express
-- FORCE ROW LEVEL SECURITY, and the serving role owns both tenant tables, so
-- without FORCE it would bypass every owner policy. Regeneration must
-- re-append them (src/db/AGENTS.md P1).
CREATE TYPE "public"."media_provenance" AS ENUM('upload', 'read', 'prompt-import');--> statement-breakpoint
CREATE TYPE "public"."media_variant" AS ENUM('original', 'model');--> statement-breakpoint
CREATE TABLE "media_blobs" (
	"media_id" uuid NOT NULL,
	"variant" "media_variant" NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "media_blobs_media_id_variant_pk" PRIMARY KEY("media_id","variant")
);
--> statement-breakpoint
ALTER TABLE "media_blobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"provenance" "media_provenance" NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"model_media_type" text NOT NULL,
	"model_width" integer NOT NULL,
	"model_height" integer NOT NULL,
	"model_byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_objects_owner_sha256_unique" UNIQUE("owner_user_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "media_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_blobs" ADD CONSTRAINT "media_blobs_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "media_blobs_owner_select" ON "media_blobs" AS PERMISSIVE FOR SELECT TO public USING (media_id IN (
        SELECT id FROM media_objects
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "media_blobs_owner_insert" ON "media_blobs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (media_id IN (
        SELECT id FROM media_objects
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "media_objects_owner_select" ON "media_objects" AS PERMISSIVE FOR SELECT TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "media_objects_owner_insert" ON "media_objects" AS PERMISSIVE FOR INSERT TO public WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
ALTER TABLE "media_objects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_blobs" FORCE ROW LEVEL SECURITY;