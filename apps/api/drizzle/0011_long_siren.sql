ALTER TABLE "emails" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "emails_tenant_isolation" ON "emails" CASCADE;--> statement-breakpoint
DROP TABLE "emails" CASCADE;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "handle" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_org_handle_unique" UNIQUE("organization_id","handle");