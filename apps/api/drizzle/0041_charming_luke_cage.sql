ALTER TABLE "agent_refs" DROP CONSTRAINT "agent_refs_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT "channel_messages_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_threads" DROP CONSTRAINT "channel_threads_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT "channels_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "comment_mentions" DROP CONSTRAINT "comment_mentions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "comment_message_edits" DROP CONSTRAINT "comment_message_edits_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "comment_messages" DROP CONSTRAINT "comment_messages_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "end_user_tokens" DROP CONSTRAINT "end_user_tokens_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "end_users" DROP CONSTRAINT "end_users_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT "environments_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "session_items" DROP CONSTRAINT "session_items_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "session_items" DROP CONSTRAINT "session_items_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "starred_sessions" DROP CONSTRAINT "starred_sessions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_jobs" DROP CONSTRAINT "webhook_jobs_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_refs" ADD CONSTRAINT "agent_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_message_edits" ADD CONSTRAINT "comment_message_edits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_user_tokens" ADD CONSTRAINT "end_user_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_sessions" ADD CONSTRAINT "starred_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;