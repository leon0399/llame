ALTER TABLE "runs" ADD COLUMN "model_id" text;
UPDATE "runs" SET "model_id" = 'system:openai:gpt-5.4-mini' WHERE "model_id" IS NULL;
ALTER TABLE "runs" ALTER COLUMN "model_id" SET NOT NULL;
