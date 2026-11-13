ALTER TABLE "knowledge_spaces" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;--> statement-breakpoint
DROP INDEX "messages_chat_absorbed_through_seq_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_absorbed_through_seq_uidx" ON "messages" ("chat_id","absorbed_through_seq") WHERE "absorbed_through_seq" IS NOT NULL;--> statement-breakpoint
DROP INDEX "project_repositories_owner_project_primary_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_owner_project_primary_uidx" ON "project_repositories" ("owner_user_id","project_id") WHERE "is_primary";--> statement-breakpoint
DROP INDEX "chat_deliveries_job_sender_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "chat_deliveries_job_sender_unique" ON "chat_deliveries" ("sender_ref") WHERE "producer" = 'job';--> statement-breakpoint
DROP INDEX "chat_deliveries_delivered_job_message_idx";--> statement-breakpoint
CREATE INDEX "chat_deliveries_delivered_job_message_idx" ON "chat_deliveries" ("chat_id","delivered_message_id","position") WHERE "producer" = 'job' and "mode" = 'notice' and "state" = 'delivered';--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_seq_positive", ADD CONSTRAINT "messages_seq_positive" CHECK ("seq" > 0);--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_workspace_detach_reason_check", ADD CONSTRAINT "chats_workspace_detach_reason_check" CHECK ("workspace_detach_reason" IS NULL OR "workspace_detach_reason" IN ('executor_mismatch', 'executor_absent', 'root_missing', 'root_moved', 'permission_rejected', 'tool_not_allowed'));--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_permission_mode_check", ADD CONSTRAINT "runs_permission_mode_check" CHECK ("permission_mode" IN ('default', 'bypass', 'read-only'));--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_checkpoint_boundary_check", ADD CONSTRAINT "messages_checkpoint_boundary_check" CHECK (("role"::text = 'checkpoint') = ("absorbed_through_seq" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_shape", ADD CONSTRAINT "media_objects_shape" CHECK (("media_type" <> 'application/pdf'
        AND "width" IS NOT NULL AND "height" IS NOT NULL
        AND "model_media_type" IS NOT NULL AND "model_width" IS NOT NULL
        AND "model_height" IS NOT NULL AND "model_byte_size" IS NOT NULL
        AND "page_count" IS NULL)
      OR ("media_type" = 'application/pdf'
        AND "page_count" IS NOT NULL AND "page_count" BETWEEN 1 AND 100
        AND "width" IS NULL AND "height" IS NULL
        AND "model_media_type" IS NULL AND "model_width" IS NULL
        AND "model_height" IS NULL AND "model_byte_size" IS NULL));--> statement-breakpoint
ALTER TABLE "machines_status" DROP CONSTRAINT "machines_status_name_check", ADD CONSTRAINT "machines_status_name_check" CHECK ("name" ~ '^[a-z0-9-]{1,63}$');--> statement-breakpoint
ALTER TABLE "machines_status" DROP CONSTRAINT "machines_status_failure_reason_check", ADD CONSTRAINT "machines_status_failure_reason_check" CHECK ("last_failure_reason" IS NULL OR "last_failure_reason" IN ('unreachable', 'host_key_mismatch', 'auth_failed', 'incompatible_version', 'session_lost'));--> statement-breakpoint
ALTER TABLE "checkouts" DROP CONSTRAINT "checkouts_kind_check", ADD CONSTRAINT "checkouts_kind_check" CHECK ("kind" IN ('main', 'worktree'));--> statement-breakpoint
ALTER TABLE "checkouts" DROP CONSTRAINT "checkouts_origin_check", ADD CONSTRAINT "checkouts_origin_check" CHECK ("origin" IN ('registered', 'adopted', 'created'));--> statement-breakpoint
ALTER TABLE "checkouts" DROP CONSTRAINT "checkouts_worktree_parent_check", ADD CONSTRAINT "checkouts_worktree_parent_check" CHECK (("kind" = 'worktree') = ("parent_checkout_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "checkouts" DROP CONSTRAINT "checkouts_worktree_base_check", ADD CONSTRAINT "checkouts_worktree_base_check" CHECK ("kind" = 'main' OR "worktree_base" IS NULL);--> statement-breakpoint
ALTER TABLE "project_repositories" DROP CONSTRAINT "project_repositories_isolation_check", ADD CONSTRAINT "project_repositories_isolation_check" CHECK ("isolation" IN ('inherit', 'always_worktree', 'never'));--> statement-breakpoint
ALTER TABLE "chat_creation_records" DROP CONSTRAINT "chat_creation_records_attempts_check", ADD CONSTRAINT "chat_creation_records_attempts_check" CHECK (jsonb_typeof("attempts") = 'array');--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_follow_up_action_check", ADD CONSTRAINT "runs_follow_up_action_check" CHECK ("follow_up_action" IS NULL OR "follow_up_action" IN ('continue', 'regenerate'));