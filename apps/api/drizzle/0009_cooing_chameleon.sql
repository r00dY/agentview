ALTER TABLE "channel_messages" ADD COLUMN "date" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "channel_messages" SET "date" = "created_at" WHERE "date" IS NULL;--> statement-breakpoint
ALTER TABLE "channel_messages" ALTER COLUMN "date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_messages" ALTER COLUMN "date" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "channel_messages_date_idx" ON "channel_messages" USING btree ("date");
