-- Hand-edited (documented in apps/api/AGENTS.md): drizzle-kit also emitted a
-- DROP/CREATE of the unchanged sessions_user_created_idx (snapshot-ordering
-- churn); removed here so the deploy doesn't rebuild an identical index and
-- briefly block writes on sessions.
ALTER TABLE "chats" ALTER COLUMN "title" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
-- Hand-authored data step (precedent: 0006's DELETE — drizzle-kit cannot generate data
-- migrations). NULL now means "untitled, awaiting generation" (#78): convert chats still
-- carrying the old 'New chat' default literal, unless the user manually confirmed that
-- exact literal as their title. Must run BEFORE the column drop below.
UPDATE "chats" SET "title" = NULL WHERE "title" = 'New chat' AND "title_manually_set_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "title_manually_set_at";