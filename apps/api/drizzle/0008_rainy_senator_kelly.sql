ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_user_id_session_item_id_session_id_unique";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_session_id_run_id_session_item_id_channel_message_id_unique" UNIQUE NULLS NOT DISTINCT("user_id","session_id","run_id","session_item_id","channel_message_id");