-- Backfill for installs whose journal marked 0009 as applied while its file
-- was empty (the original 0009 was committed empty, so the column was never
-- added). Idempotent for fresh installs where 0009 now adds the column.
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "target_path" text;
