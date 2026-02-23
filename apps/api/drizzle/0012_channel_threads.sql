-- Create channel_threads table
CREATE TABLE "channel_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"source_thread_id" varchar(255),
	"contact" varchar(255) NOT NULL,
	"contact_kind" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_threads_channel_source_contact_unique" UNIQUE("channel_id","source_thread_id","contact","contact_kind")
);
--> statement-breakpoint
CREATE INDEX "channel_threads_channel_id_idx" ON "channel_threads" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "channel_threads_status_idx" ON "channel_threads" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "channel_threads_tenant_isolation" ON "channel_threads" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint

-- Migrate channel_messages: drop old columns/indexes, add channel_thread_id
-- Since we're clearing DB anyway, just recreate the table
DROP TABLE IF EXISTS "channel_messages";
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel_thread_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"source_id" varchar(255),
	"text" text,
	"attachments" jsonb,
	"provider_data" jsonb,
	"run_id" uuid,
	"status" varchar(32) NOT NULL,
	"fail_reason" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_messages_thread_source_unique" ON "channel_messages" USING btree ("channel_thread_id","source_id");
--> statement-breakpoint
CREATE INDEX "channel_messages_thread_id_idx" ON "channel_messages" USING btree ("channel_thread_id");
--> statement-breakpoint
CREATE INDEX "channel_messages_run_id_idx" ON "channel_messages" USING btree ("run_id");
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_thread_id_channel_threads_id_fk" FOREIGN KEY ("channel_thread_id") REFERENCES "public"."channel_threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "channel_messages_tenant_isolation" ON "channel_messages" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint

-- Update sessions: drop old channel columns, add new channel_thread_id FK
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_channel_id_channels_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_channel_thread_idx";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "channel_id";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "channel_thread_id";
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "channel_thread_id" uuid;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_thread_id_channel_threads_id_fk" FOREIGN KEY ("channel_thread_id") REFERENCES "public"."channel_threads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sessions_channel_thread_idx" ON "sessions" USING btree ("channel_thread_id");
