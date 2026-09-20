-- ===========================================================================
-- Head-to-head challenge links, and games that start from a position.
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once, and it touches nothing that
-- already exists.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase ("startFen"),
-- while table names are the snake_case @@map values ("challenges", "games").
-- ===========================================================================
--
-- WHAT THIS IS FOR
--
-- Two things a challenge could not previously say.
--
--   1. WHERE THE GAME STARTS. `Challenge` and `Game` both assumed the standard
--      opening, so there was nowhere to put "play the Immortal Game from move
--      18 against me". NULL keeps meaning the standard start, which is what
--      lets every existing row and every old client behave exactly as before.
--
--   2. WHETHER IT IS A LINK. An open challenge with a null opponentId is
--      already a shareable invite — and it is ALSO what `openChallenges` hands
--      to the next stranger who taps Start, and what the house-bot poll
--      answers. Without "viaLink" the two are the same row, so a challenge
--      sent over WhatsApp would be eaten within one poll interval by somebody
--      who never asked for it. Defaults to false, so every existing row stays
--      exactly what it was: a seek.
--
-- WHY IT IS SAFE TO RUN ON A LIVE DATABASE
--
-- `ADD COLUMN` with no DEFAULT and no NOT NULL is catalog-only in PostgreSQL:
-- no table rewrite, no per-row work, constant time however many games exist.
-- "viaLink" does carry a default, and a boolean default on PG 11+ is also
-- metadata-only.
--
-- The real risk is lock QUEUEING rather than duration. `ALTER TABLE` takes an
-- ACCESS EXCLUSIVE lock for microseconds, but it must first wait for any open
-- transaction touching the table — and while it waits, every new query queues
-- behind it. `lock_timeout` makes that fail fast and roll back cleanly instead
-- of stalling the API. If it times out, just run it again.
--
-- Both statements are in one transaction, so you cannot end up with half of
-- this applied.
--
-- No RLS statements: "challenges" and "games" already exist and already carry
-- whatever policies they were created with. The RLS blocks in the other
-- manual_apply files are there because those files create new tables.
--
-- ORDERING
--
-- Run this BEFORE deploying the code. Prisma's generated client will believe
-- these columns exist the moment the new build ships; if Postgres disagrees,
-- every challenge creation fails — not just the ones with a position on them.
-- ===========================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "challenges"
  ADD COLUMN IF NOT EXISTS "startFen"     TEXT,
  ADD COLUMN IF NOT EXISTS "positionSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "viaLink"      BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "games"
  ADD COLUMN IF NOT EXISTS "startFen"     TEXT,
  ADD COLUMN IF NOT EXISTS "positionSlug" TEXT;

COMMIT;

-- ===========================================================================
-- VERIFY — expect five rows, and "viaLink" the only one that is NOT NULL.
-- ===========================================================================
--
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE (table_name, column_name) IN (
--   ('challenges','startFen'), ('challenges','positionSlug'),
--   ('challenges','viaLink'),
--   ('games','startFen'),      ('games','positionSlug'))
-- ORDER BY table_name, column_name;
--
-- And that nothing was already relying on a column that is not there:
--
-- SELECT count(*) FROM challenges WHERE "viaLink" IS NOT false;   -- expect 0
-- SELECT count(*) FROM games      WHERE "startFen" IS NOT NULL;   -- expect 0
--
-- Then, from the repo, the check that actually proves it landed:
--
--   npx prisma migrate diff \
--     --from-schema-datasource prisma/schema.prisma \
--     --to-schema-datamodel  prisma/schema.prisma \
--     --exit-code
--
-- Exit 0 means the live database and the models agree. Exit 2 prints the SQL
-- still outstanding, which is exactly what "the migration file exists and was
-- never run" looks like.
-- ===========================================================================
