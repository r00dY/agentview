ALTER TABLE "end_users" RENAME COLUMN "created_by" TO "owner_id";--> statement-breakpoint
ALTER TABLE "end_users" DROP CONSTRAINT "end_users_created_by_space_check";--> statement-breakpoint
ALTER TABLE "end_users" DROP CONSTRAINT "end_users_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_owner_id_space_check" CHECK ((space = 'production' AND owner_id IS NULL) OR (space != 'production' AND owner_id IS NOT NULL));