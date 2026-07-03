CREATE TYPE "public"."memory_source" AS ENUM('user', 'agent');--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source" "memory_source" DEFAULT 'agent' NOT NULL;