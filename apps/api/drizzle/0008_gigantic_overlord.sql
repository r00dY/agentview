ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_user_id_session_item_id_session_id_unique";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_session_id_session_item_id_run_id_unique" UNIQUE NULLS NOT DISTINCT("user_id","session_id","session_item_id","run_id");