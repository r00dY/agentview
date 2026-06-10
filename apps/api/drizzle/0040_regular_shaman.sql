CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL
);
