ALTER TABLE "comment_messages" DROP CONSTRAINT "comment_messages_target_check";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_target_check";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_target_check";--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT "channel_messages_run_id_runs_id_fk";
--> statement-breakpoint
DROP INDEX "channel_messages_run_id_idx";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "first_incoming_channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "last_incoming_channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "outgoing_channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_first_incoming_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("first_incoming_channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_last_incoming_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("last_incoming_channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_outgoing_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("outgoing_channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Data migration: populate run's channel message references from channel_messages.run_id
UPDATE "runs" SET
  "first_incoming_channel_message_id" = sub.first_id,
  "last_incoming_channel_message_id" = sub.last_id
FROM (
  SELECT cm.run_id,
    (ARRAY_AGG(cm.id ORDER BY cm.date ASC))[1] AS first_id,
    (ARRAY_AGG(cm.id ORDER BY cm.date DESC))[1] AS last_id
  FROM "channel_messages" cm
  WHERE cm.run_id IS NOT NULL AND cm.direction = 'incoming'
  GROUP BY cm.run_id
) sub
WHERE "runs".id = sub.run_id;--> statement-breakpoint

UPDATE "runs" SET "outgoing_channel_message_id" = cm.id
FROM "channel_messages" cm
WHERE cm.run_id = "runs".id AND cm.direction = 'outgoing';--> statement-breakpoint

-- Data migration: clear run_id on target tables where channel_message_id is set
UPDATE "comment_messages" SET "run_id" = NULL WHERE "channel_message_id" IS NOT NULL AND "run_id" IS NOT NULL;--> statement-breakpoint
UPDATE "scores" SET "run_id" = NULL WHERE "channel_message_id" IS NOT NULL AND "run_id" IS NOT NULL;--> statement-breakpoint
UPDATE "inbox_items" SET "run_id" = NULL WHERE "channel_message_id" IS NOT NULL AND "run_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "channel_messages" DROP COLUMN "run_id";--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ));
