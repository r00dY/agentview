ALTER TABLE "sessions" DROP CONSTRAINT "sessions_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "created_by";