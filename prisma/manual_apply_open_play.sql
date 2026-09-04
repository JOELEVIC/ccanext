-- ===========================================================================
-- Open play: friends, an open challenge pool, and clubs anybody can create.
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once, and it changes nothing that
-- already exists except by adding columns with defaults.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase
-- ("openToChallenges"), while TABLE names are the snake_case @@map values.
-- ===========================================================================
--
-- WHAT THIS IS FOR
--
-- Until now the only way to play another person on this platform was to be in
-- the same club as them: ccaweb scopes its challenge screen to `clubRoster`
-- and says why in its own header. That was a safeguarding decision taken by
-- default rather than deliberately, and it has now been taken deliberately in
-- the other direction — anybody may be challenged unless they say otherwise.
--
-- Three things follow, and all three are in this file.
--
--   1. A per-player switch, so "unless they say otherwise" is a real option
--      and not a sentence in a policy document.
--   2. A per-club switch, so a patron can answer for thirty eleven-year-olds
--      at once rather than hoping thirty families each find the setting.
--   3. Friendship, so somebody can be reached by a person who is not in their
--      club and not a stranger either.
--
-- WHAT THIS DOES NOT CHANGE
--
-- §4.3. Consent reduction is untouched and stays untouched: a non-consented
-- minor is "Brenda A." with a null avatar in the open pool, in a friend
-- search and in a challenge list, exactly as they are everywhere else. This
-- migration changes WHO MAY BE CHALLENGED. It does not change WHOSE NAME IS
-- PUBLISHED, and the two gates must never be collapsed into one.
--
-- ===========================================================================

BEGIN;

-- ── 1. The player's own switches ──────────────────────────────────────────
--
-- Both default TRUE. A platform where nobody is matchable has no games on it,
-- and a record nobody can see is not a record.
--
-- "phone" is a LOOKUP KEY and nothing else. No resolver returns it — not to
-- the owner, not to staff — and it is matched only on a whole normalised
-- value, so no query can be used to walk the space of numbers. The unique
-- index is what makes an exact match a single indexed read rather than a
-- scan, which is also what makes it cheap to rate-limit.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "openToChallenges" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "gamesPublic"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "phone"            TEXT;

-- Plain, not partial. A partial index `WHERE "phone" IS NOT NULL` behaves
-- identically — Postgres already treats NULLs as distinct in a unique index,
-- so several rows may hold NULL either way — and Prisma cannot express one,
-- which makes `migrate diff` report it as drift and propose dropping it. An
-- index the schema does not know about is an index a later migration removes.
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_phone_key" ON "profiles" ("phone");

-- ── 2. The club's switches ────────────────────────────────────────────────
--
-- "isPrivate" hides the ROSTER, never the club. A school that exists is a
-- fact, its name is in a public directory and its results are in a league
-- table; what a private club withholds is the list of its children, which is
-- the part a stranger browsing for an opponent does not need.
--
-- "poolOptOut" removes its members from the open draw. It does NOT stop a
-- named challenge from a club-mate or a friend — being invited by somebody
-- who sought you out is a different act from being dealt to a stranger.

ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "isPrivate"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "poolOptOut" BOOLEAN NOT NULL DEFAULT false;

-- ── 3. A club nobody has approved yet ─────────────────────────────────────
--
-- PENDING_REVIEW is not ONBOARDING. ONBOARDING already means "staff made it
-- and have not published it"; this means "somebody who is not staff made it
-- and nobody has agreed it should exist". The distinction matters because the
-- two are answered by different people.
--
-- It is deliberately absent from PUBLIC_CLUB_STATUSES in
-- domains/club/club.repository.ts, so a club awaiting review is invisible in
-- the directory and its join code finds nothing.
--
-- ADD VALUE IF NOT EXISTS is transactional from PostgreSQL 12, so it may sit
-- inside this BEGIN block. It is added BEFORE 'ONBOARDING' so the enum reads
-- in lifecycle order, which is what `ORDER BY status` will follow.

ALTER TYPE "club_status" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW' BEFORE 'ONBOARDING';

-- ── 4. Friendship ─────────────────────────────────────────────────────────
--
-- Accept-based, never one-way. A follow is something you do TO somebody; a
-- friendship is something two people agree to, and the whole point of the
-- relation here is that it grants standing to send a child a direct
-- invitation. That standing has to be given rather than taken.
--
-- BLOCKED is this same row rather than a second table: somebody who blocks a
-- person is saying "no, and stop asking", and a block living elsewhere would
-- let a request be re-sent past a check nobody joined against.
--
-- One row per ORDERED pair is all an index can enforce. Refusing a request
-- when a row exists in EITHER direction is the service's job — see
-- domains/friend/friend.service.ts.

DO $$ BEGIN
  CREATE TYPE "friendship_status" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "friendships" (
  "id"          TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "addresseeId" TEXT NOT NULL,
  "status"      "friendship_status" NOT NULL DEFAULT 'PENDING',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "friendships_requesterId_addresseeId_key"
  ON "friendships" ("requesterId", "addresseeId");
CREATE INDEX IF NOT EXISTS "friendships_addresseeId_status_idx"
  ON "friendships" ("addresseeId", "status");
CREATE INDEX IF NOT EXISTS "friendships_requesterId_status_idx"
  ON "friendships" ("requesterId", "status");

DO $$ BEGIN
  ALTER TABLE "friendships"
    ADD CONSTRAINT "friendships_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "friendships"
    ADD CONSTRAINT "friendships_addresseeId_fkey"
    FOREIGN KEY ("addresseeId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- A row must have two different people in it. Cheap, and it forecloses a
-- self-friendship that would otherwise show up as a duplicate of yourself in
-- every opponent list.
DO $$ BEGIN
  ALTER TABLE "friendships"
    ADD CONSTRAINT "friendships_not_self" CHECK ("requesterId" <> "addresseeId");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. Switches staff can throw without a deploy ──────────────────────────
--
-- A key/value table rather than a column per setting, because these are
-- operational levers rather than domain facts: "does club creation need
-- approval" is a policy somebody changes on a Tuesday, not an attribute of
-- anything. A column would need a migration each time.
--
-- No rows are inserted here on purpose. An unwritten key resolves to its
-- default in PlatformSettingService, so an empty table behaves exactly like
-- the safe position of every switch — and the safe position for club
-- creation is "approval required".

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "key"       TEXT NOT NULL,
  "value"     JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

COMMIT;

-- ===========================================================================
-- CORRECTION — only needed on a database that ran an earlier copy of this file
-- ===========================================================================
--
-- The first version of the block above created the phone index as PARTIAL.
-- It works exactly the same way, and Prisma cannot express it, so
-- `prisma migrate diff` reports it as drift and proposes dropping it. Left
-- alone it is harmless; the cost is that the drift check stops being a useful
-- signal, because there is always one line in it.
--
-- Safe to run on a database that never had the partial index: the DROP is
-- conditional and the CREATE is the same statement as above.

DROP INDEX IF EXISTS "profiles_phone_key";
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_phone_key" ON "profiles" ("phone");

-- ===========================================================================
-- VERIFY — run this after, and expect the counts in the comments.
-- ===========================================================================
--
-- Three new profile columns, two new club columns:
--
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE (table_name = 'profiles'
--           AND column_name IN ('openToChallenges','gamesPublic','phone'))
--       OR (table_name = 'clubs'
--           AND column_name IN ('isPrivate','poolOptOut'))
--    ORDER BY table_name, column_name;                        -- 5 rows
--
-- The new club status, first in the enum:
--
--   SELECT unnest(enum_range(NULL::club_status));             -- PENDING_REVIEW first
--
-- Two new tables and their indexes:
--
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE tablename IN ('friendships','platform_settings')
--    ORDER BY tablename, indexname;                           -- 5 rows
--
-- And nothing was switched off for anybody who already exists:
--
--   SELECT count(*) FROM profiles WHERE "openToChallenges" IS NOT TRUE;  -- 0
