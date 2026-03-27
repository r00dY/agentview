DROP INDEX "runs_fetch_status_idx";--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "runs" DROP COLUMN "fetch_status";