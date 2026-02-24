-- Remove name column from channels
ALTER TABLE "channels" DROP COLUMN IF EXISTS "name";
--> statement-breakpoint
-- Drop old unique constraint and create new one (type, address) instead of (org, type, address)
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_org_type_address_unique";
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_type_address_unique" UNIQUE("type","address");
