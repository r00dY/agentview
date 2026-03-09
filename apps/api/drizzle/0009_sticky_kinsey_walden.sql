ALTER TABLE "comment_messages" DROP CONSTRAINT "comment_messages_target_check";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_target_check";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_session_item_id_session_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_session_id_sessions_id_fk";
--> statement-breakpoint
DROP INDEX "scores_session_item_unique";--> statement-breakpoint
DROP INDEX "scores_run_unique";--> statement-breakpoint
ALTER TABLE "comment_messages" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_session_item_id_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_created_by_session_id_run_id_session_item_id_channel_message_id_name_unique" UNIQUE NULLS NOT DISTINCT("created_by","session_id","run_id","session_item_id","channel_message_id","name");--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));