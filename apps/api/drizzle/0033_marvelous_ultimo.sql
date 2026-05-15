ALTER TABLE "runs" DROP CONSTRAINT "runs_first_incoming_channel_message_id_channel_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_last_incoming_channel_message_id_channel_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_outgoing_channel_message_id_channel_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_messages_run_id_idx" ON "channel_messages" USING btree ("run_id");--> statement-breakpoint

-- Backfill: outgoing messages get runId from runs.outgoing_channel_message_id
UPDATE channel_messages cm SET run_id = r.id
FROM runs r WHERE r.outgoing_channel_message_id = cm.id;--> statement-breakpoint

-- Backfill: incoming messages by createdAt range between first and last
UPDATE channel_messages cm SET run_id = r.id
FROM runs r
JOIN channel_messages first_cm ON first_cm.id = r.first_incoming_channel_message_id
JOIN channel_messages last_cm ON last_cm.id = r.last_incoming_channel_message_id
WHERE cm.channel_thread_id = first_cm.channel_thread_id
  AND cm.direction = 'incoming'
  AND cm.created_at >= first_cm.created_at
  AND cm.created_at <= last_cm.created_at
  AND cm.run_id IS NULL;--> statement-breakpoint

ALTER TABLE "runs" DROP COLUMN "first_incoming_channel_message_id";--> statement-breakpoint
ALTER TABLE "runs" DROP COLUMN "last_incoming_channel_message_id";--> statement-breakpoint
ALTER TABLE "runs" DROP COLUMN "outgoing_channel_message_id";