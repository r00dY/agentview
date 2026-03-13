ALTER TABLE "sessions" ADD COLUMN "agent_ref_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "initial_state" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_ref_id_agent_refs_id_fk" FOREIGN KEY ("agent_ref_id") REFERENCES "public"."agent_refs"("id") ON DELETE no action ON UPDATE no action;