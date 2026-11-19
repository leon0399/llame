-- Add the quota status without rewriting the enum, preserving deployed Run
-- status values. Postgres cannot use this new value until the migration
-- transaction commits; subsequent migrations in this batch must not use it.
ALTER TYPE "run_status" ADD VALUE 'awaiting_quota' BEFORE 'completed';