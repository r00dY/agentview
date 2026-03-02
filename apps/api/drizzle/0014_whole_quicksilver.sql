ALTER TABLE "runs" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "channel_type" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "channel_address" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "channel";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "channel_thread_consistency" CHECK ((channel_type = 'api' AND channel_thread_id IS NULL) OR (channel_type != 'api' AND channel_thread_id IS NOT NULL));