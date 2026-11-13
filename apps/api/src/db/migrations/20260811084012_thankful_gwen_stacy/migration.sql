DROP INDEX "model_context_snapshots_owner_content_source_unique_idx";--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ALTER COLUMN "availability_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ALTER COLUMN "tool_availability_manifest" DROP DEFAULT;