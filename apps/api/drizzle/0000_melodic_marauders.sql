CREATE TABLE "agent_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" varchar(255) NOT NULL,
	"agent" varchar(255) NOT NULL,
	"adapter" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_refs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel_thread_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"status" varchar(32) NOT NULL,
	"reason" jsonb,
	"source_id" varchar(255),
	"text" text,
	"author_email" varchar(255),
	"author_name" varchar(255),
	"author_headline" varchar(255),
	"author_details" text,
	"attachments" jsonb,
	"provider_data" jsonb,
	"date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"internal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"source_thread_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_threads_channel_source_unique" UNIQUE("channel_id","source_thread_id")
);
--> statement-breakpoint
ALTER TABLE "channel_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type" varchar(64) NOT NULL,
	"address" varchar(255) NOT NULL,
	"config" jsonb NOT NULL,
	"environment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_type_address_org_unique" UNIQUE("type","address","organization_id")
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"comment_message_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_message_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"comment_message_id" uuid NOT NULL,
	"previous_content" text,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_message_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"session_item_id" uuid,
	"run_id" uuid,
	"channel_message_id" uuid,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "comment_messages_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ))
);
--> statement-breakpoint
ALTER TABLE "comment_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "end_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"external_id" varchar(255),
	"name" text,
	"email" varchar(255),
	"headline" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" text,
	"space" varchar(24) NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	CONSTRAINT "end_users_owner_id_space_check" CHECK ((space = 'production' AND owner_id IS NULL AND shared = false) OR (space = 'playground' AND owner_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "end_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" varchar(255) NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"value" jsonb,
	"tunnel_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_org_handle_unique" UNIQUE("organization_id","handle"),
	CONSTRAINT "environments_org_user_unique" UNIQUE NULLS NOT DISTINCT("organization_id","user_id"),
	CONSTRAINT "environments_tunnel_url_user_check" CHECK (tunnel_url IS NULL OR user_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "environments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" text,
	"type" varchar(256) NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid,
	"session_item_id" uuid,
	"channel_message_id" uuid,
	"last_read_event_id" bigint,
	"last_notifiable_event_id" bigint,
	"has_important" boolean DEFAULT false NOT NULL,
	"render" jsonb NOT NULL,
	CONSTRAINT "inbox_items_user_id_session_id_run_id_session_item_id_channel_message_id_unique" UNIQUE NULLS NOT DISTINCT("user_id","session_id","run_id","session_item_id","channel_message_id"),
	CONSTRAINT "inbox_items_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ))
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"agent_ref_id" uuid,
	"status" varchar(255) NOT NULL,
	"reason" jsonb,
	"response_data" jsonb,
	"metadata" jsonb,
	"manual" boolean DEFAULT false NOT NULL,
	"environment_id" uuid,
	"previous_run_id" uuid,
	"active" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid,
	"session_item_id" uuid,
	"channel_message_id" uuid,
	"name" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "scores_created_by_session_id_run_id_session_item_id_channel_message_id_name_unique" UNIQUE NULLS NOT DISTINCT("created_by","session_id","run_id","session_item_id","channel_message_id","name"),
	CONSTRAINT "scores_target_check" CHECK ((
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  ))
);
--> statement-breakpoint
ALTER TABLE "scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sort_order" serial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" jsonb,
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"is_state" boolean DEFAULT false NOT NULL,
	"type" varchar(24),
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "session_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"end_user_id" uuid NOT NULL,
	"title" text,
	"agent_ref_id" uuid,
	"initial_state" jsonb,
	"channel_thread_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "starred_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starred_sessions_user_id_session_id_unique" UNIQUE("user_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "starred_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"environment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"session_id" uuid,
	"status" varchar(64) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "webhook_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikeys" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_refs" ADD CONSTRAINT "agent_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_thread_id_channel_threads_id_fk" FOREIGN KEY ("channel_thread_id") REFERENCES "public"."channel_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_message_id_comment_messages_id_fk" FOREIGN KEY ("comment_message_id") REFERENCES "public"."comment_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_message_edits" ADD CONSTRAINT "comment_message_edits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_message_edits" ADD CONSTRAINT "comment_message_edits_comment_message_id_comment_messages_id_fk" FOREIGN KEY ("comment_message_id") REFERENCES "public"."comment_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_session_item_id_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_user_tokens" ADD CONSTRAINT "end_user_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_user_tokens" ADD CONSTRAINT "end_user_tokens_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_session_item_id_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_last_read_event_id_events_id_fk" FOREIGN KEY ("last_read_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_last_notifiable_event_id_events_id_fk" FOREIGN KEY ("last_notifiable_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_ref_id_agent_refs_id_fk" FOREIGN KEY ("agent_ref_id") REFERENCES "public"."agent_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_previous_run_id_runs_id_fk" FOREIGN KEY ("previous_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_session_item_id_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_channel_message_id_channel_messages_id_fk" FOREIGN KEY ("channel_message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_comment_id_comment_messages_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_ref_id_agent_refs_id_fk" FOREIGN KEY ("agent_ref_id") REFERENCES "public"."agent_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_thread_id_channel_threads_id_fk" FOREIGN KEY ("channel_thread_id") REFERENCES "public"."channel_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_sessions" ADD CONSTRAINT "starred_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_sessions" ADD CONSTRAINT "starred_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_sessions" ADD CONSTRAINT "starred_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ref_version_agent_adapter_org_unique" ON "agent_refs" USING btree ("version","agent","adapter","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_messages_thread_source_unique" ON "channel_messages" USING btree ("channel_thread_id","source_id");--> statement-breakpoint
CREATE INDEX "channel_messages_thread_id_idx" ON "channel_messages" USING btree ("channel_thread_id");--> statement-breakpoint
CREATE INDEX "channel_messages_status_direction_idx" ON "channel_messages" USING btree ("status","direction");--> statement-breakpoint
CREATE INDEX "channel_messages_date_idx" ON "channel_messages" USING btree ("date");--> statement-breakpoint
CREATE INDEX "channel_messages_run_id_idx" ON "channel_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "channel_threads_channel_id_idx" ON "channel_threads" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channels_address_idx" ON "channels" USING btree ("address");--> statement-breakpoint
CREATE INDEX "end_user_tokens_user_id_idx" ON "end_user_tokens" USING btree ("end_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "end_user_external_id_org_unique" ON "end_users" USING btree ("external_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "end_user_email_org_unique" ON "end_users" USING btree ("email","organization_id");--> statement-breakpoint
CREATE INDEX "runs_expires_at_status_idx" ON "runs" USING btree ("expires_at","status");--> statement-breakpoint
CREATE INDEX "runs_session_id_created_at_idx" ON "runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_channel_thread_idx" ON "sessions" USING btree ("channel_thread_id");--> statement-breakpoint
CREATE INDEX "webhook_jobs_status_next_attempt_idx" ON "webhook_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_jobs_session_id_idx" ON "webhook_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikeys_configId_idx" ON "apikeys" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikeys_referenceId_idx" ON "apikeys" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikeys_key_idx" ON "apikeys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "authSessions_userId_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_organizationId_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "members_organizationId_idx" ON "members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "members_userId_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uidx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE POLICY "agent_refs_tenant_isolation" ON "agent_refs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "channel_messages_tenant_isolation" ON "channel_messages" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "channel_threads_tenant_isolation" ON "channel_threads" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "channels_tenant_isolation" ON "channels" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "comment_mentions_tenant_isolation" ON "comment_mentions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "comment_message_edits_tenant_isolation" ON "comment_message_edits" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "comment_messages_tenant_isolation" ON "comment_messages" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "end_user_tokens_tenant_isolation" ON "end_user_tokens" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "end_users_tenant_isolation" ON "end_users" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "environments_tenant_isolation" ON "environments" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "events_tenant_isolation" ON "events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "inbox_items_tenant_isolation" ON "inbox_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "runs_tenant_isolation" ON "runs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "scores_tenant_isolation" ON "scores" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "session_items_tenant_isolation" ON "session_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "starred_sessions_tenant_isolation" ON "starred_sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "webhook_jobs_tenant_isolation" ON "webhook_jobs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));