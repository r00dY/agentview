DROP INDEX "sessions_handle_org_unique";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "handle_number";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "handle_suffix";