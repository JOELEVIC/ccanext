-- ===========================================================================
-- House players: accounts the platform plays itself when nobody else will.
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once. It adds one column, eight users
-- and eight profiles, and removes any Glicko rows those eight might have.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase ("isHouseBot"),
-- while TABLE names are the snake_case @@map values ("users", "profiles").
-- ===========================================================================
--
-- WHAT THIS IS FOR
--
-- A student who taps "Anyone" posts a seek. With a few dozen accounts on the
-- platform, most seeks find nobody and expire a day later. The cca game server
-- now watches for seeks a human has not taken within 20–45 seconds and plays
-- them with one of these accounts, at the account's rating, with human-like
-- think times. It also answers a direct challenge to one of them.
--
-- WHY A COLUMN AND NOT A NAMING CONVENTION
--
-- The existing sample accounts are identified by a "sample-" id prefix and an
-- "@sample.invalid" email, which is fine for a purge script and not fine for a
-- leaderboard: a resolver has to be able to ask "is this a person?" in one
-- place. `isHouseBot` is that place. It also gates the two GraphQL operations
-- the game server uses to act as them, so a flag on the wrong row would be a
-- security bug — which is why it has a default of false and nothing ever sets
-- it but this file.
--
-- WHY THEY CANNOT SIGN IN
--
-- "passwordHash" is a sentinel, not a bcrypt hash. bcryptjs.compareSync
-- returns false for any string that is not a well-formed 60-character hash,
-- so no password can ever match (verified). Emails end in the reserved
-- .invalid TLD so Google sign-in can never resolve to one of these rows.
--
-- WHY ADULTS, AND WHY NO CLUB
--
-- §4.3 reduces a non-consented minor's name to "Brenda A." with no avatar.
-- These are born 1989–1998, so their full names show — a house player that
-- appeared as an initial would be one more thing to explain. They belong to
-- no club: a club roster and a division table are lists of real people, and
-- "one ACTIVE membership per user" is an invariant this does not touch.
--
-- Ratings 400..1500 in even steps, so a seeker at any level has one within
-- reach. The rating is FIXED: `applyGlickoRatings` updates the human only.

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isHouseBot" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "users_isHouseBot_idx" ON "users" ("isHouseBot");

INSERT INTO "users"
  ("id","email","username","passwordHash","role","rating","placementRequired","placementCompletedAt",
   "publicNameMode","isHouseBot","createdAt","updatedAt")
VALUES
  ('house-bot-01','house01@house.invalid','ngono_mbarga',   '!house-player:no-login','STUDENT', 400,false,now(),'FULL',true,now(),now()),
  ('house-bot-02','house02@house.invalid','achille_tchamba','!house-player:no-login','STUDENT', 560,false,now(),'FULL',true,now(),now()),
  ('house-bot-03','house03@house.invalid','marthe_fotso',   '!house-player:no-login','STUDENT', 720,false,now(),'FULL',true,now(),now()),
  ('house-bot-04','house04@house.invalid','bertrand_nkeng', '!house-player:no-login','STUDENT', 880,false,now(),'FULL',true,now(),now()),
  ('house-bot-05','house05@house.invalid','solange_ewane',  '!house-player:no-login','STUDENT',1040,false,now(),'FULL',true,now(),now()),
  ('house-bot-06','house06@house.invalid','cyrille_tabi',   '!house-player:no-login','STUDENT',1200,false,now(),'FULL',true,now(),now()),
  ('house-bot-07','house07@house.invalid','hermine_bilong', '!house-player:no-login','STUDENT',1360,false,now(),'FULL',true,now(),now()),
  ('house-bot-08','house08@house.invalid','emmanuel_ndip',  '!house-player:no-login','STUDENT',1500,false,now(),'FULL',true,now(),now())
ON CONFLICT ("id") DO UPDATE
  SET "rating" = EXCLUDED."rating",
      "isHouseBot" = true,
      "placementRequired" = false,
      "passwordHash" = EXCLUDED."passwordHash",
      "updatedAt" = now();

INSERT INTO "profiles"
  ("id","userId","firstName","lastName","dateOfBirth","country","openToChallenges","gamesPublic","createdAt","updatedAt")
VALUES
  ('house-prof-01','house-bot-01','Ngono',   'Mbarga', '1996-03-11','CM',true,true,now(),now()),
  ('house-prof-02','house-bot-02','Achille', 'Tchamba','1994-07-02','CM',true,true,now(),now()),
  ('house-prof-03','house-bot-03','Marthe',  'Fotso',  '1998-01-19','CM',true,true,now(),now()),
  ('house-prof-04','house-bot-04','Bertrand','Nkeng',  '1991-10-27','CM',true,true,now(),now()),
  ('house-prof-05','house-bot-05','Solange', 'Ewane',  '1997-05-08','CM',true,true,now(),now()),
  ('house-prof-06','house-bot-06','Cyrille', 'Tabi',   '1989-12-30','CM',true,true,now(),now()),
  ('house-prof-07','house-bot-07','Hermine', 'Bilong', '1995-08-15','CM',true,true,now(),now()),
  ('house-prof-08','house-bot-08','Emmanuel','Ndip',   '1992-04-23','CM',true,true,now(),now())
ON CONFLICT ("userId") DO UPDATE
  SET "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "dateOfBirth" = EXCLUDED."dateOfBirth",
      "openToChallenges" = true,
      "updatedAt" = now();

-- A house player's rating is fixed. Glicko never writes one, and any row
-- that got here some other way must not be allowed to drift it.
DELETE FROM "player_ratings"
 WHERE "userId" IN (SELECT "id" FROM "users" WHERE "isHouseBot");

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after the block above; every count is 8, 8, 0)
-- ---------------------------------------------------------------------------
-- SELECT count(*) FROM users WHERE "isHouseBot";
-- SELECT count(*) FROM profiles p JOIN users u ON u.id = p."userId"
--  WHERE u."isHouseBot" AND p."dateOfBirth" < now() - interval '18 years';
-- SELECT count(*) FROM player_ratings pr JOIN users u ON u.id = pr."userId"
--  WHERE u."isHouseBot";
