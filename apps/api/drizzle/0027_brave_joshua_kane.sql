ALTER TABLE "runs" ADD COLUMN "previous_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "active" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_previous_run_id_runs_id_fk" FOREIGN KEY ("previous_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;