ALTER TABLE "sessions" DROP CONSTRAINT "channel_thread_consistency";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "channel_type";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "channel_address";