-- ===========================================================================
-- Challenge results — the board behind a shared challenge link.
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once, and it touches nothing that
-- already exists.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase ("scenarioId").
-- ===========================================================================
--
-- WHAT THIS IS FOR
--
-- A challenge link carries its own game: bot, position, colour and clock are
-- encoded in the URL, so creating and forwarding one writes nothing. This is
-- the other half — what happens after somebody plays it and wants their result
-- to stand somewhere.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No name, no email, no account, no IP. Whoever posts a result arrived from a
-- message thread, has agreed to nothing, and may well be a child: BUILD_PLAN
-- §4.3 treats unknown age as a minor, and an anonymous submitter's age is
-- unknown by definition. So the only thing stored about a person is a HANDLE
-- they typed, knowing it is public.
--
-- There is no foreign key on "scenarioId" either. A scenario is a computed
-- identity — a hash of the challenge's terms — not a row anybody created. Two
-- people who independently set up the same game produce the same id and share
-- one board, which is the whole point.
--
-- ===========================================================================

-- ── The results ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "challenge_results" (
  "id"           TEXT PRIMARY KEY,
  "scenarioId"   TEXT NOT NULL,
  "handle"       TEXT NOT NULL,
  "result"       "game_result" NOT NULL,
  "colour"       TEXT NOT NULL,
  "moves"        INTEGER NOT NULL,
  "verified"     BOOLEAN NOT NULL DEFAULT FALSE,
  "movesSAN"     TEXT NOT NULL,
  "botId"        TEXT NOT NULL,
  "positionSlug" TEXT,
  "clockId"      TEXT,
  "startFen"     TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The board's own query: one scenario, verified first, fewest moves first.
CREATE INDEX IF NOT EXISTS "challenge_results_board_idx"
  ON "challenge_results" ("scenarioId", "verified", "moves");

CREATE INDEX IF NOT EXISTS "challenge_results_createdAt_idx"
  ON "challenge_results" ("createdAt");

-- ── The throttle ───────────────────────────────────────────────────────────
-- Mirrors "enquiry_throttle". Stores a SHA-256 digest of the caller's first
-- hop, never the address itself.
CREATE TABLE IF NOT EXISTS "challenge_throttle" (
  "id"              TEXT PRIMARY KEY,
  "key"             TEXT NOT NULL,
  "count"           INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "challenge_throttle_key_key"
  ON "challenge_throttle" ("key");

CREATE INDEX IF NOT EXISTS "challenge_throttle_windowStartedAt_idx"
  ON "challenge_throttle" ("windowStartedAt");

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Matching every other table here: the API connects as the owner and is the
-- only writer, so enabling RLS with no policy closes the anon key off entirely.
ALTER TABLE "challenge_results"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "challenge_throttle" ENABLE ROW LEVEL SECURITY;

-- ── Check ──────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM "challenge_results";
-- SELECT COUNT(*) FROM "challenge_throttle";
