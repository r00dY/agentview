ALTER TABLE "scores" DROP CONSTRAINT "scores_session_item_id_name_created_by_unique";--> statement-breakpoint
ALTER TABLE "comment_messages" ALTER COLUMN "session_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ALTER COLUMN "session_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD COLUMN "channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_session_item_unique" ON "scores" USING btree ("session_item_id","name","created_by") WHERE session_item_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_run_unique" ON "scores" USING btree ("run_id","name","created_by") WHERE run_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_target_check" CHECK ((
    (session_item_id IS NOT NULL AND run_id IS NULL AND channel_message_id IS NULL) OR
    (session_item_id IS NULL AND run_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_item_id IS NULL AND run_id IS NULL AND channel_message_id IS NOT NULL)
  ));--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_target_check" CHECK ((
    (session_item_id IS NOT NULL AND run_id IS NULL) OR
    (session_item_id IS NULL AND run_id IS NOT NULL)
  ));