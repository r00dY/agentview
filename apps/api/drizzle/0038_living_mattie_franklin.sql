ALTER TABLE "channel_messages" ADD COLUMN "reason" jsonb;--> statement-breakpoint
ALTER TABLE "channel_messages" DROP COLUMN "fail_reason";