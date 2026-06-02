ALTER TABLE "end_users" DROP CONSTRAINT "end_users_owner_id_space_check";--> statement-breakpoint
ALTER TABLE "end_users" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "end_users" SET "space" = 'playground', "shared" = true WHERE "space" = 'shared-playground';--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_owner_id_space_check" CHECK ((space = 'production' AND owner_id IS NULL AND shared = false) OR (space = 'playground' AND owner_id IS NOT NULL));