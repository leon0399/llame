ALTER TABLE "chats" ADD COLUMN "skill_catalog_baseline" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "skill_catalog_rebaked_from" uuid;