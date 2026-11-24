CREATE TYPE "run_origin" AS ENUM('owner', 'agent');--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "origin" "run_origin" DEFAULT 'owner'::"run_origin" NOT NULL;