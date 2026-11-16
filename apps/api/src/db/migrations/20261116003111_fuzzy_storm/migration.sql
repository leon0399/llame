ALTER TABLE "runs" ADD COLUMN "kind" text DEFAULT 'turn' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_kind_check" CHECK ("kind" IN ('turn', 'compaction'));