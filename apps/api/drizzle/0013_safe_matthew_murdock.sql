-- Replace session.channel (nullable varchar) with channel_type + channel_address (non-null)
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "channel";
ALTER TABLE "sessions" ADD COLUMN "channel_type" varchar(64) NOT NULL DEFAULT 'api';
ALTER TABLE "sessions" ADD COLUMN "channel_address" varchar(255) NOT NULL DEFAULT '';
ALTER TABLE "sessions" ALTER COLUMN "channel_type" DROP DEFAULT;
ALTER TABLE "sessions" ALTER COLUMN "channel_address" DROP DEFAULT;

-- CHECK: api channels must NOT have channel_thread_id, external channels MUST have it
ALTER TABLE "sessions" ADD CONSTRAINT "channel_thread_consistency"
  CHECK ((channel_type = 'api' AND channel_thread_id IS NULL) OR (channel_type != 'api' AND channel_thread_id IS NOT NULL));
