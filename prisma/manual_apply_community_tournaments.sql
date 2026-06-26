-- Schema apply for Community Activities + Professional Tournaments.
-- Paste into the Supabase SQL editor and run. Idempotent + additive (safe to re-run).
-- Columns are quoted camelCase (this Prisma schema doesn't snake_case fields).

-- ===========================================================================
-- 1) Tournaments — additive pro-engine columns
-- ===========================================================================
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "totalRounds" INTEGER;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "currentRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "tiebreak" TEXT NOT NULL DEFAULT 'BUCHHOLZ';
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "registrationOpensAt" TIMESTAMP(3);
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkInRequired" BOOLEAN NOT NULL DEFAULT false;

-- ===========================================================================
-- 2) Tournament participants — pairing + tiebreak state
-- ===========================================================================
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "colorHistory" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "opponentIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "byes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "checkedIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "withdrawn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "buchholz" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tournament_participants" ADD COLUMN IF NOT EXISTS "sonnebornBerger" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ===========================================================================
-- 3) Tournament rounds + pairings
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'round_status') THEN
        CREATE TYPE "round_status" AS ENUM ('PENDING', 'ONGOING', 'COMPLETED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tournament_rounds" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "round_status" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournament_rounds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_rounds_tournamentId_number_key" ON "tournament_rounds"("tournamentId", "number");
CREATE INDEX IF NOT EXISTS "tournament_rounds_tournamentId_idx" ON "tournament_rounds"("tournamentId");

CREATE TABLE IF NOT EXISTS "tournament_pairings" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "boardNumber" INTEGER NOT NULL DEFAULT 1,
    "whiteUserId" TEXT,
    "blackUserId" TEXT,
    "gameId" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournament_pairings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tournament_pairings_roundId_idx" ON "tournament_pairings"("roundId");
CREATE INDEX IF NOT EXISTS "tournament_pairings_tournamentId_idx" ON "tournament_pairings"("tournamentId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_rounds_tournamentId_fkey') THEN
        ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_tournamentId_fkey"
            FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_pairings_roundId_fkey') THEN
        ALTER TABLE "tournament_pairings" ADD CONSTRAINT "tournament_pairings_roundId_fkey"
            FOREIGN KEY ("roundId") REFERENCES "tournament_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ===========================================================================
-- 4) Community activities
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_type') THEN
        CREATE TYPE "activity_type" AS ENUM ('ANNOUNCEMENT', 'EVENT_RECAP', 'ARTICLE', 'GALLERY', 'RESULT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_status') THEN
        CREATE TYPE "activity_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "activities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "activity_type" NOT NULL DEFAULT 'ARTICLE',
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "bodyJson" JSONB,
    "bodyText" TEXT,
    "coverImageUrl" TEXT,
    "videoEmbedUrl" TEXT,
    "region" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT '{}',
    "status" "activity_status" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "authorAdminId" TEXT,
    "eventDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "activities_slug_key" ON "activities"("slug");
CREATE INDEX IF NOT EXISTS "activities_status_publishedAt_idx" ON "activities"("status", "publishedAt");
CREATE INDEX IF NOT EXISTS "activities_type_idx" ON "activities"("type");
CREATE INDEX IF NOT EXISTS "activities_featured_idx" ON "activities"("featured");

CREATE TABLE IF NOT EXISTS "activity_images" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "activity_images_activityId_idx" ON "activity_images"("activityId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_images_activityId_fkey') THEN
        ALTER TABLE "activity_images" ADD CONSTRAINT "activity_images_activityId_fkey"
            FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
