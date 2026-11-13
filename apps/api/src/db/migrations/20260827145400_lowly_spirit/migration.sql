DROP INDEX "messages_chat_seq_idx";--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "first_message_text_offset" integer;--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "last_message_text_offset_exclusive" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_seq_unique_idx" ON "messages" USING btree ("chat_id","seq");