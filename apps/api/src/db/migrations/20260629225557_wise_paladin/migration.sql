ALTER TABLE "messages" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "in_reply_to" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_in_reply_to_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;