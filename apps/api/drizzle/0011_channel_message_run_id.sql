ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "channel_messages_run_id_idx" ON "channel_messages" ("run_id");
