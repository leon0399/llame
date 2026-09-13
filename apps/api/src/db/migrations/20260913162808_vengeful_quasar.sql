CREATE TYPE "public"."usage_origin_kind" AS ENUM('run', 'message', 'compaction');--> statement-breakpoint
CREATE TYPE "public"."usage_provenance" AS ENUM('local', 'inherited');--> statement-breakpoint
CREATE TABLE "message_turn_contexts" (
	"chat_id" uuid NOT NULL,
	"origin_run_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"effort" text,
	"accepted_at" timestamp with time zone NOT NULL,
	"snapshot_id" uuid,
	"context_revision" bigint NOT NULL,
	"source_max_seq" bigint NOT NULL,
	"active_compaction_id" uuid,
	"digest_rebaked_from" uuid,
	"digest_baseline" jsonb,
	"digest_told" jsonb,
	"context_items" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_turn_contexts_pk" PRIMARY KEY("chat_id","origin_run_id")
);
--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "inherited_context_origin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "context_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "initial_continuation_state" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "initial_active_compaction_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "initial_digest_rebaked_from" uuid;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "usage_origin_kind" "usage_origin_kind";--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "usage_origin_id" text;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "usage_provenance" "usage_provenance";--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "context_revision" bigint;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "source_max_seq" bigint;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "companion_active_compaction_id" uuid;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "companion_digest_rebaked_from" uuid;--> statement-breakpoint
ALTER TABLE "compactions" ADD COLUMN "companion_state" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "inherited_turn_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "usage_origin_kind" "usage_origin_kind";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "usage_origin_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "usage_provenance" "usage_provenance";--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_message_chat_fk" FOREIGN KEY ("message_id","chat_id") REFERENCES "public"."messages"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_snapshot_owner_fk" FOREIGN KEY ("snapshot_id","owner_user_id") REFERENCES "public"."model_context_snapshots"("id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_active_compaction_fk" FOREIGN KEY ("active_compaction_id","chat_id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turn_contexts" ADD CONSTRAINT "message_turn_contexts_digest_rebaked_from_fk" FOREIGN KEY ("digest_rebaked_from","chat_id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_turn_contexts_chat_revision_idx" ON "message_turn_contexts" USING btree ("chat_id","context_revision");--> statement-breakpoint
-- Manual: chats → compactions composite FKs for initial continuation state.
-- These are NOT in the Drizzle schema (forward-reference cycle prevents it;
-- see chats.ts initialActiveCompactionId comment). Regeneration must restore
-- both statements.
ALTER TABLE "chats" ADD CONSTRAINT "chats_initial_active_compaction_id_fk" FOREIGN KEY ("initial_active_compaction_id","id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_initial_digest_rebaked_from_fk" FOREIGN KEY ("initial_digest_rebaked_from","id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compactions" ADD CONSTRAINT "compactions_companion_active_compaction_id_fk" FOREIGN KEY ("companion_active_compaction_id","chat_id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compactions" ADD CONSTRAINT "compactions_companion_digest_rebaked_from_fk" FOREIGN KEY ("companion_digest_rebaked_from","chat_id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "message_turn_contexts_owner" ON "message_turn_contexts" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));
-- Manual: FORCE ROW LEVEL SECURITY on message_turn_contexts.
-- Drizzle emits ENABLE only; FORCE is load-bearing for the single-role
-- self-hosted case (P1 trap, same precedent as migration 0004/0009).
-- If you regenerate this migration, re-add this statement.
ALTER TABLE "message_turn_contexts" FORCE ROW LEVEL SECURITY;