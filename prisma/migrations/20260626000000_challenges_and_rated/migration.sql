-- Ranked/casual flag on games + the Challenge (invite) system.
-- Written idempotently so it's also safe to paste manually into the Supabase SQL editor.

ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "rated" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
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

DO $$
BEGIN
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
