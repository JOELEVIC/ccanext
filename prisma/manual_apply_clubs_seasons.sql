-- ===========================================================================
-- Clubs · Seasons · Divisions · Fixtures · Club life · Safeguarding · Intake
-- BUILD_PLAN §3.1–3.2 (T0.1 / P0-A).
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and ADDITIVE — safe to run more than once, and it drops or renames nothing.
--
-- ⚠️ Apply this BEFORE deploying the commit that regenerates the Prisma client:
-- the client selects the new columns on every users / schools / games /
-- activities read, so deploying first would 500 those surfaces.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names, so columns are quoted camelCase ("joinCode").
-- Enum TYPE names, and table names, ARE snake_cased via @@map.
-- ===========================================================================


-- ===========================================================================
-- 0) Enum types
-- Guarded individually so a partially-applied run can be resumed.
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'school_kind') THEN
        CREATE TYPE "school_kind" AS ENUM ('SECONDARY', 'UNIVERSITY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'game_source') THEN
        CREATE TYPE "game_source" AS ENUM ('ONLINE', 'OTB');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'validation_state') THEN
        CREATE TYPE "validation_state" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VALIDATED', 'DISPUTED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'public_name_mode') THEN
        CREATE TYPE "public_name_mode" AS ENUM ('INITIAL', 'FULL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'club_level') THEN
        CREATE TYPE "club_level" AS ENUM ('SECONDARY', 'UNIVERSITY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'club_status') THEN
        CREATE TYPE "club_status" AS ENUM ('ONBOARDING', 'ACTIVE', 'DORMANT', 'ARCHIVED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
        CREATE TYPE "membership_role" AS ENUM ('PLAYER', 'CAPTAIN', 'PATRON', 'ASSISTANT_COACH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
        CREATE TYPE "membership_status" AS ENUM ('PENDING', 'ACTIVE', 'LEFT', 'REMOVED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'honour_kind') THEN
        CREATE TYPE "honour_kind" AS ENUM ('TROPHY', 'TITLE', 'PROMOTION', 'MILESTONE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'season_status') THEN
        CREATE TYPE "season_status" AS ENUM ('PLANNED', 'ACTIVE', 'ARCHIVED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'competition') THEN
        CREATE TYPE "competition" AS ENUM ('DIVISION', 'CUP', 'ZONAL_FINAL', 'NATIONAL_FINAL', 'FRIENDLY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cup_stage') THEN
        CREATE TYPE "cup_stage" AS ENUM ('R32', 'R16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixture_status') THEN
        CREATE TYPE "fixture_status" AS ENUM ('SCHEDULED', 'TEAM_SHEETS', 'LIVE', 'AWAITING_VALIDATION', 'VALIDATED', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'piece_color') THEN
        CREATE TYPE "piece_color" AS ENUM ('WHITE', 'BLACK');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_kind') THEN
        CREATE TYPE "event_kind" AS ENUM ('MATCH_START', 'BOARD_RESULT', 'VALIDATED', 'NOTE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
        CREATE TYPE "session_status" AS ENUM ('SCHEDULED', 'HELD', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_state') THEN
        CREATE TYPE "attendance_state" AS ENUM ('PRESENT', 'EXCUSED', 'ABSENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_status') THEN
        CREATE TYPE "consent_status" AS ENUM ('PENDING', 'GRANTED', 'DECLINED', 'WITHDRAWN');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_method') THEN
        CREATE TYPE "consent_method" AS ENUM ('SMS', 'WHATSAPP', 'PAPER', 'EMAIL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enquiry_status') THEN
        CREATE TYPE "enquiry_status" AS ENUM ('NEW', 'CONTACTED', 'MEETING_BOOKED', 'SIGNED', 'DECLINED');
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================================================
-- 1) Additive columns on existing tables (BUILD_PLAN §3.2)
-- ===========================================================================

-- schools: slug / kind / town. A school may host more than one club.
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "kind" "school_kind" NOT NULL DEFAULT 'SECONDARY';
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "town" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "schools_slug_key" ON "schools"("slug");

-- games: source / validationState / clubContextId.
-- validationState != NOT_REQUIRED tells the `cca` game server to SKIP its own
-- rating write (BUILD_PLAN §4.4) — a fixture board rates once, at validation.
-- Existing rows keep NOT_REQUIRED, so today's games rate exactly as before.
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "source" "game_source" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "validationState" "validation_state" NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "clubContextId" TEXT;

-- users: publicNameMode. INITIAL is the protective default (BUILD_PLAN §4.3);
-- it may only be flipped to FULL while guardian consent is GRANTED.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "publicNameMode" "public_name_mode" NOT NULL DEFAULT 'INITIAL';

-- activities: club news feed. null = academy-level post.
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "clubId" TEXT;
CREATE INDEX IF NOT EXISTS "activities_clubId_idx" ON "activities"("clubId");


-- ===========================================================================
-- 2) Clubs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "clubs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "level" "club_level" NOT NULL DEFAULT 'SECONDARY',
    "crestJson" JSONB,
    "status" "club_status" NOT NULL DEFAULT 'ONBOARDING',
    "joinCode" TEXT NOT NULL,
    "foundedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_slug_key" ON "clubs"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_joinCode_key" ON "clubs"("joinCode");
CREATE INDEX IF NOT EXISTS "clubs_region_idx" ON "clubs"("region");
CREATE INDEX IF NOT EXISTS "clubs_status_idx" ON "clubs"("status");
CREATE INDEX IF NOT EXISTS "clubs_schoolId_idx" ON "clubs"("schoolId");

CREATE TABLE IF NOT EXISTS "club_memberships" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'PLAYER',
    "status" "membership_status" NOT NULL DEFAULT 'PENDING',
    "schoolYear" TEXT,
    "boardOrder" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "club_memberships_clubId_userId_key" ON "club_memberships"("clubId", "userId");
CREATE INDEX IF NOT EXISTS "club_memberships_userId_idx" ON "club_memberships"("userId");
CREATE INDEX IF NOT EXISTS "club_memberships_clubId_status_idx" ON "club_memberships"("clubId", "status");

-- ONE ACTIVE MEMBERSHIP PER USER (BUILD_PLAN §2). A player represents one club
-- per season. Prisma cannot express a partial unique index, so it lives here
-- and here only — the service layer must not be the sole guard.
CREATE UNIQUE INDEX IF NOT EXISTS "club_memberships_userId_active_key"
    ON "club_memberships"("userId")
    WHERE "status" = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "club_honours" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "honour_kind" NOT NULL DEFAULT 'TROPHY',
    "awardedOn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_honours_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "club_honours_clubId_idx" ON "club_honours"("clubId");


-- ===========================================================================
-- 3) Seasons, divisions, division tables
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "seasons" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "status" "season_status" NOT NULL DEFAULT 'PLANNED',
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_slug_key" ON "seasons"("slug");

CREATE TABLE IF NOT EXISTS "divisions" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "regions" TEXT[] NOT NULL DEFAULT '{}',
    "level" "club_level" NOT NULL DEFAULT 'SECONDARY',
    "totalMatchDays" INTEGER NOT NULL DEFAULT 14,
    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "divisions_seasonId_name_level_key" ON "divisions"("seasonId", "name", "level");
CREATE INDEX IF NOT EXISTS "divisions_seasonId_idx" ON "divisions"("seasonId");

-- Derived from VALIDATED fixtures only — never hand-edited, never incremented
-- in place from a UI action. `position` and `previousPosition` are written by
-- the same recompute (domains/fixture/scoring.ts).
CREATE TABLE IF NOT EXISTS "division_entries" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "drawn" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "byes" INTEGER NOT NULL DEFAULT 0,
    "matchPoints" INTEGER NOT NULL DEFAULT 0,
    "boardPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" INTEGER,
    "previousPosition" INTEGER,
    "formJson" JSONB,
    CONSTRAINT "division_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "division_entries_divisionId_clubId_key" ON "division_entries"("divisionId", "clubId");
CREATE INDEX IF NOT EXISTS "division_entries_divisionId_idx" ON "division_entries"("divisionId");


-- ===========================================================================
-- 4) Fixtures, boards, events
-- "homeClubId"/"awayClubId" are NULLABLE on purpose: a bye has no away club,
-- and a cup placeholder has neither until its feeding ties resolve.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "fixtures" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT,
    "competition" "competition" NOT NULL DEFAULT 'DIVISION',
    "stage" "cup_stage",
    "matchDay" INTEGER,
    "homeClubId" TEXT,
    "awayClubId" TEXT,
    "homeSourceLabel" TEXT,
    "awaySourceLabel" TEXT,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "boardCount" INTEGER NOT NULL DEFAULT 4,
    "status" "fixture_status" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "awayScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arbiterId" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fixtures_seasonId_scheduledAt_idx" ON "fixtures"("seasonId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "fixtures_divisionId_matchDay_idx" ON "fixtures"("divisionId", "matchDay");
CREATE INDEX IF NOT EXISTS "fixtures_homeClubId_idx" ON "fixtures"("homeClubId");
CREATE INDEX IF NOT EXISTS "fixtures_awayClubId_idx" ON "fixtures"("awayClubId");
CREATE INDEX IF NOT EXISTS "fixtures_status_idx" ON "fixtures"("status");

-- `result` reuses the EXISTING "game_result" enum — one encoding, no mapping
-- layer. White-first ("1-0") and home-first ("2½–1½") are display rules,
-- resolved from "homeColor" at render time.
CREATE TABLE IF NOT EXISTS "fixture_boards" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "boardNumber" INTEGER NOT NULL,
    "homeUserId" TEXT,
    "awayUserId" TEXT,
    "homeColor" "piece_color" NOT NULL DEFAULT 'WHITE',
    "source" "game_source" NOT NULL DEFAULT 'OTB',
    "gameId" TEXT,
    "result" "game_result",
    "scoresheetUrl" TEXT,
    "moveCount" INTEGER,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3),
    "ratedAt" TIMESTAMP(3),
    CONSTRAINT "fixture_boards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "fixture_boards_gameId_key" ON "fixture_boards"("gameId");
CREATE UNIQUE INDEX IF NOT EXISTS "fixture_boards_fixtureId_boardNumber_key" ON "fixture_boards"("fixtureId", "boardNumber");
CREATE INDEX IF NOT EXISTS "fixture_boards_fixtureId_idx" ON "fixture_boards"("fixtureId");

CREATE TABLE IF NOT EXISTS "fixture_events" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "kind" "event_kind" NOT NULL,
    "board" INTEGER,
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fixture_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fixture_events_fixtureId_occurredAt_idx" ON "fixture_events"("fixtureId", "occurredAt");


-- ===========================================================================
-- 5) Club life
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "club_sessions" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "planJson" JSONB,
    "status" "session_status" NOT NULL DEFAULT 'SCHEDULED',
    CONSTRAINT "club_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "club_sessions_clubId_startsAt_idx" ON "club_sessions"("clubId", "startsAt");

CREATE TABLE IF NOT EXISTS "session_attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "attendance_state" NOT NULL DEFAULT 'ABSENT',
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "session_attendance_sessionId_userId_key" ON "session_attendance"("sessionId", "userId");
CREATE INDEX IF NOT EXISTS "session_attendance_userId_idx" ON "session_attendance"("userId");


-- ===========================================================================
-- 6) Safeguarding — guardian consent
-- Consent gates DISPLAY, not participation (BUILD_PLAN §3.3 #5 / §4.3).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "guardian_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "consent_status" NOT NULL DEFAULT 'PENDING',
    "method" "consent_method",
    "guardianName" TEXT,
    "guardianContact" TEXT,
    "countersignedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "guardian_consents_userId_key" ON "guardian_consents"("userId");
CREATE INDEX IF NOT EXISTS "guardian_consents_status_idx" ON "guardian_consents"("status");


-- ===========================================================================
-- 7) Intake — school enquiries
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "school_enquiries" (
    "id" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "town" TEXT,
    "region" TEXT NOT NULL,
    "level" "club_level" NOT NULL DEFAULT 'SECONDARY',
    "sizeBand" TEXT,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "note" TEXT,
    "wantsFrench" BOOLEAN NOT NULL DEFAULT false,
    "status" "enquiry_status" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "school_enquiries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "school_enquiries_status_createdAt_idx" ON "school_enquiries"("status", "createdAt");


-- ===========================================================================
-- 8) Foreign keys
-- Added after every table exists so the file can be run top-to-bottom once.
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_schoolId_fkey') THEN
        ALTER TABLE "clubs" ADD CONSTRAINT "clubs_schoolId_fkey"
            FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_memberships_clubId_fkey') THEN
        ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_clubId_fkey"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_memberships_userId_fkey') THEN
        ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_honours_clubId_fkey') THEN
        ALTER TABLE "club_honours" ADD CONSTRAINT "club_honours_clubId_fkey"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_honours_seasonId_fkey') THEN
        ALTER TABLE "club_honours" ADD CONSTRAINT "club_honours_seasonId_fkey"
            FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_seasonId_fkey') THEN
        ALTER TABLE "divisions" ADD CONSTRAINT "divisions_seasonId_fkey"
            FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'division_entries_divisionId_fkey') THEN
        ALTER TABLE "division_entries" ADD CONSTRAINT "division_entries_divisionId_fkey"
            FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'division_entries_clubId_fkey') THEN
        ALTER TABLE "division_entries" ADD CONSTRAINT "division_entries_clubId_fkey"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_seasonId_fkey') THEN
        ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_seasonId_fkey"
            FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_divisionId_fkey') THEN
        ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_divisionId_fkey"
            FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_homeClubId_fkey') THEN
        ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_homeClubId_fkey"
            FOREIGN KEY ("homeClubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_awayClubId_fkey') THEN
        ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_awayClubId_fkey"
            FOREIGN KEY ("awayClubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_arbiterId_fkey') THEN
        ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_arbiterId_fkey"
            FOREIGN KEY ("arbiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_boards_fixtureId_fkey') THEN
        ALTER TABLE "fixture_boards" ADD CONSTRAINT "fixture_boards_fixtureId_fkey"
            FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_boards_homeUserId_fkey') THEN
        ALTER TABLE "fixture_boards" ADD CONSTRAINT "fixture_boards_homeUserId_fkey"
            FOREIGN KEY ("homeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_boards_awayUserId_fkey') THEN
        ALTER TABLE "fixture_boards" ADD CONSTRAINT "fixture_boards_awayUserId_fkey"
            FOREIGN KEY ("awayUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_boards_gameId_fkey') THEN
        ALTER TABLE "fixture_boards" ADD CONSTRAINT "fixture_boards_gameId_fkey"
            FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixture_events_fixtureId_fkey') THEN
        ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_fixtureId_fkey"
            FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_sessions_clubId_fkey') THEN
        ALTER TABLE "club_sessions" ADD CONSTRAINT "club_sessions_clubId_fkey"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_attendance_sessionId_fkey') THEN
        ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "club_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_attendance_userId_fkey') THEN
        ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardian_consents_userId_fkey') THEN
        ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_clubId_fkey') THEN
        ALTER TABLE "activities" ADD CONSTRAINT "activities_clubId_fkey"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


-- ===========================================================================
-- 9) Row Level Security
-- Every new table gets RLS ENABLED with NO policies. The API reaches Postgres
-- as the `postgres` role (BYPASSRLS), so Prisma is unaffected; this only shuts
-- the door on Supabase's anon/authenticated PostgREST surface, which nothing
-- in this stack uses. Join codes and guardian contacts must never be readable
-- with a publishable key. ENABLE is idempotent — re-running is a no-op.
-- ===========================================================================
ALTER TABLE "clubs"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "club_memberships"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "club_honours"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seasons"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "divisions"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "division_entries"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixtures"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixture_boards"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixture_events"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "club_sessions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_consents"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_enquiries"   ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 10) Verify (optional — run and eyeball the counts, all should be present)
-- ===========================================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('clubs','club_memberships','club_honours','seasons',
--                       'divisions','division_entries','fixtures','fixture_boards',
--                       'fixture_events','club_sessions','session_attendance',
--                       'guardian_consents','school_enquiries')
--  ORDER BY table_name;
--
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'club_memberships' AND indexname = 'club_memberships_userId_active_key';


-- ===========================================================================
-- 11) Enquiry throttle (BUILD_PLAN §6 — rate-limiting submitSchoolEnquiry)
-- Appended by P0-A part 2. Sections 0–10 above are unchanged.
--
-- `submitSchoolEnquiry` is public and unauthenticated. Vercel serverless has no
-- shared memory, so an in-process counter cannot rate-limit anything: each
-- invocation may be a fresh container. The counter lives here instead — one row
-- per (scope, key) with a rolling window, incremented inside a transaction.
--
-- "key" is a SHA-256 of the client IP or of the normalised phone number, never
-- the raw value. This table's job is to say "too many", not to keep a record of
-- who tried.
--
-- RLS is enabled here rather than in section 9 so that section stays exactly as
-- the orchestrator left it; the policy is identical — ENABLE, no policies.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "enquiry_throttle" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enquiry_throttle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "enquiry_throttle_scope_key_key" ON "enquiry_throttle"("scope", "key");
CREATE INDEX IF NOT EXISTS "enquiry_throttle_windowStartedAt_idx" ON "enquiry_throttle"("windowStartedAt");

ALTER TABLE "enquiry_throttle" ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 12) Region normalisation — activities.region (BUILD_PLAN §2)
--
-- "Regions are a fixed key set, not free text. […] Note the existing
--  `Activity.region` column holds French free text ("Sud-Ouest") — T0.1
--  includes a normalisation pass."
--
-- One-off and idempotent: the WHERE clause skips rows already holding a
-- canonical key, and the CASE leaves anything it does not recognise untouched
-- rather than guessing. Running this twice is a no-op.
--
-- SCOPE, deliberately: only "activities". `schools.region` is NOT normalised —
-- the shipped `schoolsByRegion(region:)` surface in ccaui passes the legacy
-- free-text values, and rewriting that column would break it. `clubs.region`
-- and `divisions.regions` are new and are written canonical from day one.
--
-- The API also normalises the `region` ARGUMENT on the way in
-- (domains/region/regions.ts → normalizeRegion), so a client still sending
-- "Sud-Ouest" keeps working after this runs.
-- ===========================================================================
UPDATE "activities"
   SET "region" = CASE lower(btrim("region"))
        WHEN 'extreme-nord'  THEN 'FAR_NORTH'
        WHEN 'extrême-nord'  THEN 'FAR_NORTH'
        WHEN 'extreme nord'  THEN 'FAR_NORTH'
        WHEN 'extrême nord'  THEN 'FAR_NORTH'
        WHEN 'far north'     THEN 'FAR_NORTH'
        WHEN 'far-north'     THEN 'FAR_NORTH'
        WHEN 'nord'          THEN 'NORTH'
        WHEN 'north'         THEN 'NORTH'
        WHEN 'adamaoua'      THEN 'ADAMAWA'
        WHEN 'adamawa'       THEN 'ADAMAWA'
        WHEN 'centre'        THEN 'CENTRE'
        WHEN 'center'        THEN 'CENTRE'
        WHEN 'central'       THEN 'CENTRE'
        WHEN 'est'           THEN 'EAST'
        WHEN 'east'          THEN 'EAST'
        WHEN 'sud'           THEN 'SOUTH'
        WHEN 'south'         THEN 'SOUTH'
        WHEN 'littoral'      THEN 'LITTORAL'
        WHEN 'ouest'         THEN 'WEST'
        WHEN 'west'          THEN 'WEST'
        WHEN 'nord-ouest'    THEN 'NORTH_WEST'
        WHEN 'nord ouest'    THEN 'NORTH_WEST'
        WHEN 'north-west'    THEN 'NORTH_WEST'
        WHEN 'north west'    THEN 'NORTH_WEST'
        WHEN 'northwest'     THEN 'NORTH_WEST'
        WHEN 'sud-ouest'     THEN 'SOUTH_WEST'
        WHEN 'sud ouest'     THEN 'SOUTH_WEST'
        WHEN 'south-west'    THEN 'SOUTH_WEST'
        WHEN 'south west'    THEN 'SOUTH_WEST'
        WHEN 'southwest'     THEN 'SOUTH_WEST'
        ELSE "region"
       END
 WHERE "region" IS NOT NULL
   AND btrim("region") <> ''
   AND "region" NOT IN ('FAR_NORTH','NORTH','ADAMAWA','CENTRE','EAST','SOUTH',
                        'LITTORAL','WEST','NORTH_WEST','SOUTH_WEST');

-- Anything left un-normalised is free text nobody anticipated. Eyeball it:
-- SELECT DISTINCT "region" FROM "activities"
--  WHERE "region" IS NOT NULL
--    AND "region" NOT IN ('FAR_NORTH','NORTH','ADAMAWA','CENTRE','EAST','SOUTH',
--                         'LITTORAL','WEST','NORTH_WEST','SOUTH_WEST');
