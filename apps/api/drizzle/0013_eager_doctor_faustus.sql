ALTER TABLE "versions" RENAME TO "agent_refs";--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_version_id_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_refs" DROP CONSTRAINT "versions_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "version_agent_org_unique";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "agent_ref_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_refs" ADD COLUMN "format" varchar(24) NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_ref_id_agent_refs_id_fk" FOREIGN KEY ("agent_ref_id") REFERENCES "public"."agent_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_refs" ADD CONSTRAINT "agent_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ref_version_agent_org_unique" ON "agent_refs" USING btree ("version","agent","organization_id");--> statement-breakpoint
ALTER TABLE "runs" DROP COLUMN "version_id";--> statement-breakpoint
DROP POLICY "versions_tenant_isolation" ON "agent_refs" CASCADE;--> statement-breakpoint
CREATE POLICY "agent_refs_tenant_isolation" ON "agent_refs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));