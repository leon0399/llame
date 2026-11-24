-- Retire the one-time digest producer columns after the standalone TypeScript
-- upgrade has converted proven disclosures. Drizzle cannot express this data
-- conversion or its transaction-local completion witness.
DO $$
BEGIN
  IF current_setting('app.recency_digest_upgrade_witness', true) IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'recency digest upgrade witness is required before column deletion';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "recency_digest_baseline";--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "recency_digest_told";--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "recency_digest_rebaked_from";