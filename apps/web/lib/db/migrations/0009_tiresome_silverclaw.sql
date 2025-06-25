ALTER TABLE "Message_v2" RENAME TO "Message";--> statement-breakpoint
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_v2_chatId_Chat_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
