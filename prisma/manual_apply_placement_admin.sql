-- Schema apply for the placement (auto-rating) + admin-dashboard features.
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase ("placementRequired").

-- ===========================================================================
-- 1) Placement flags on users
-- ===========================================================================
-- placementRequired: add as NOT NULL DEFAULT true (so NEW signups need placement),
-- but backfill existing accounts to false ONCE (they already have real ratings —
-- don't drag everyone into placement). The DO-block guard makes the backfill run
-- only when the column is first created, so re-running this file is safe.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'placementRequired'
    ) THEN
        ALTER TABLE "users" ADD COLUMN "placementRequired" BOOLEAN NOT NULL DEFAULT true;
        UPDATE "users" SET "placementRequired" = false;
    END IF;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "placementCompletedAt" TIMESTAMP(3);

-- ===========================================================================
-- 2) Placement runs
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'placement_status') THEN
        CREATE TYPE "placement_status" AS ENUM ('IN_PROGRESS', 'COMPLETE', 'ABANDONED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "placement_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "placement_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "gamesJson" JSONB,
    "estimatedRating" INTEGER,
    "estimatedRd" INTEGER,
    "confidence" DOUBLE PRECISION,
    "triggeredBy" TEXT NOT NULL DEFAULT 'self',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "placement_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "placement_runs_userId_idx" ON "placement_runs"("userId");
CREATE INDEX IF NOT EXISTS "placement_runs_status_idx" ON "placement_runs"("status");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'placement_runs_userId_fkey') THEN
        ALTER TABLE "placement_runs" ADD CONSTRAINT "placement_runs_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ===========================================================================
-- 3) Admin users (separate from app users)
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role') THEN
        CREATE TYPE "admin_role" AS ENUM ('ROOT', 'ADMIN');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" "admin_role" NOT NULL DEFAULT 'ADMIN',
    "addedById" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users"("email");
CREATE INDEX IF NOT EXISTS "admin_users_email_idx" ON "admin_users"("email");

-- Seed the un-removable ROOT admin. Empty passwordHash = "pending bootstrap":
-- the FIRST successful login at the admin URL sets the password. ON CONFLICT keeps
-- the email pinned to ROOT no matter what, and is safe to re-run.
INSERT INTO "admin_users" ("id", "email", "passwordHash", "role", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'mrsinsj48@gmail.com', '', 'ROOT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO UPDATE SET "role" = 'ROOT';
