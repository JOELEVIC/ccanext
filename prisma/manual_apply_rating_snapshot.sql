-- Per-game rating snapshot: each player's rating at the moment the game was created.
-- Lets the games list show "your Elo at the time of the game" instead of your current rating.
-- Idempotent — safe to run more than once. Historical games stay NULL (UI falls back to current).
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "whiteRating" INTEGER;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "blackRating" INTEGER;
