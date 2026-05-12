ALTER TABLE "channel_threads" DROP CONSTRAINT "channel_threads_channel_source_contact_unique";--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "author_email" varchar(255);--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "author_name" varchar(255);--> statement-breakpoint
ALTER TABLE "channel_threads" DROP COLUMN "contact";--> statement-breakpoint
ALTER TABLE "channel_threads" DROP COLUMN "contact_kind";--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_channel_source_unique" UNIQUE("channel_id","source_thread_id");