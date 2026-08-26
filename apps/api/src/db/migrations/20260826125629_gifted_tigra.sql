-- add-pinned-items-reorder: owner-controlled pin rank (`position`).
-- Hand-authored around drizzle-kit's NOT NULL add (no default) + FORCE RLS
-- backfill window — same pattern as 0012/0020. Re-add the window and backfill
-- if this migration is regenerated.
DROP INDEX "pins_user_pinned_idx";--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "position" integer;--> statement-breakpoint
-- Backfill under NO FORCE: migrations run as `app` with no app.current_user_id,
-- and pins is FORCE RLS (0023), so without the window every UPDATE is denied.
ALTER TABLE "pins" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH ranked AS (
  SELECT
    user_id,
    item_type,
    item_id,
    (ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY pinned_at DESC, item_id
    ) - 1)::integer AS position
  FROM pins
)
UPDATE pins AS p
SET position = ranked.position
FROM ranked
WHERE p.user_id = ranked.user_id
  AND p.item_type = ranked.item_type
  AND p.item_id = ranked.item_id;--> statement-breakpoint
ALTER TABLE "pins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pins" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "pins_user_position_idx" ON "pins" USING btree ("user_id","position","item_id");--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_position_unique" UNIQUE("user_id","position");--> statement-breakpoint
CREATE POLICY "pins_owner_update" ON "pins" AS PERMISSIVE FOR UPDATE TO public USING (user_id = current_setting('app.current_user_id', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true));
