ALTER TABLE "chats" ADD COLUMN "workspace_root" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_executor_id" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_told" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_told_from" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_detach_reason" text;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_workspace_detach_reason_check" CHECK ("chats"."workspace_detach_reason" IS NULL OR "chats"."workspace_detach_reason" IN ('executor_mismatch', 'executor_absent', 'root_missing', 'root_moved', 'permission_rejected', 'tool_not_allowed'));