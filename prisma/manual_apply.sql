-- One-time schema apply for the Glicko ratings + Challenge/ranked features.
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once.

-- 1) Glicko-2 rating state (separate table; users row untouched)
CREATE TABLE IF NOT EXISTS "player_ratings" (
    "userId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1200,
    "deviation" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("userId")
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_ratings_userId_fkey') THEN
        ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 2) Ranked/casual flag on games
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "rated" BOOLEAN NOT NULL DEFAULT true;

-- 3) Challenge (invite) system
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_status') THEN
        CREATE TYPE "challenge_status" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS "challenges" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "opponentId" TEXT,
    "creatorColor" TEXT NOT NULL,
    "timeControl" TEXT NOT NULL,
    "rated" BOOLEAN NOT NULL DEFAULT true,
    "status" "challenge_status" NOT NULL DEFAULT 'OPEN',
    "gameId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "challenges_gameId_key" ON "challenges"("gameId");
CREATE INDEX IF NOT EXISTS "challenges_creatorId_idx" ON "challenges"("creatorId");
CREATE INDEX IF NOT EXISTS "challenges_opponentId_idx" ON "challenges"("opponentId");
CREATE INDEX IF NOT EXISTS "challenges_status_idx" ON "challenges"("status");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_creatorId_fkey') THEN
        ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creatorId_fkey"
            FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_opponentId_fkey') THEN
        ALTER TABLE "challenges" ADD CONSTRAINT "challenges_opponentId_fkey"
            FOREIGN KEY ("opponentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_gameId_fkey') THEN
        ALTER TABLE "challenges" ADD CONSTRAINT "challenges_gameId_fkey"
            FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
