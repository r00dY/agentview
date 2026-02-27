DROP INDEX "version_org_unique";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "channel" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "agent" varchar(255) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "version_agent_org_unique" ON "versions" USING btree ("version","agent","organization_id");--> statement-breakpoint
ALTER TABLE "channels" DROP COLUMN "status";