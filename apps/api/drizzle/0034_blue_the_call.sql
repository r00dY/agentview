CREATE TABLE "end_user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"end_user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "end_user_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "end_user_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "end_users" DROP CONSTRAINT "end_users_token_unique";--> statement-breakpoint
ALTER TABLE "channel_messages" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "channel_threads" ALTER COLUMN "source_thread_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "end_user_tokens" ADD CONSTRAINT "end_user_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_user_tokens" ADD CONSTRAINT "end_user_tokens_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "end_user_tokens_user_id_idx" ON "end_user_tokens" USING btree ("end_user_id");--> statement-breakpoint

-- Backfill: move existing end_users.token values into end_user_tokens
INSERT INTO "end_user_tokens" ("organization_id", "end_user_id", "token")
SELECT "organization_id", "id", "token" FROM "end_users" WHERE "token" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "end_users" DROP COLUMN "token";--> statement-breakpoint
CREATE POLICY "end_user_tokens_tenant_isolation" ON "end_user_tokens" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));