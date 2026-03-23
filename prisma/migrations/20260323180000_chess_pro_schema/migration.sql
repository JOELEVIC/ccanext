-- CreateEnum
CREATE TYPE "chess_variant" AS ENUM (
  'ULTRABULLET', 'BULLET', 'BLITZ', 'RAPID', 'CLASSIC', 'CRAZYHOUSE', 'CHESS960',
  'KOTH', 'THREECHECK', 'ANTICHESS', 'ATOMIC', 'HORDE', 'RACING_KINGS'
);

-- AlterTable profiles
ALTER TABLE "profiles" ADD COLUMN "chessTitle" TEXT;
ALTER TABLE "profiles" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "profiles" ADD COLUMN "followerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "profiles" ADD COLUMN "friendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "profiles" ADD COLUMN "ratingTrendJson" JSONB;

-- AlterTable games
ALTER TABLE "games" ADD COLUMN "analysisJson" JSONB;

-- AlterTable tournaments
ALTER TABLE "tournaments" ADD COLUMN "chessVariant" TEXT NOT NULL DEFAULT 'Blitz';
ALTER TABLE "tournaments" ADD COLUMN "arenaTimeControl" TEXT NOT NULL DEFAULT '3+0';
ALTER TABLE "tournaments" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'ARENA';
ALTER TABLE "tournaments" ADD COLUMN "maxPlayers" INTEGER NOT NULL DEFAULT 450;
ALTER TABLE "tournaments" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "tournaments" ADD COLUMN "cardColor" TEXT NOT NULL DEFAULT 'blue';
ALTER TABLE "tournaments" ADD COLUMN "isSponsored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournaments" ADD COLUMN "isRated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tournaments" ADD COLUMN "iconType" TEXT;
ALTER TABLE "tournaments" ADD COLUMN "prizePoolJson" JSONB;

CREATE INDEX "tournaments_startDate_idx" ON "tournaments"("startDate");

-- CreateTable user_variant_ratings
CREATE TABLE "user_variant_ratings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variant" "chess_variant" NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "ratingDelta" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_variant_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_variant_ratings_userId_variant_key" ON "user_variant_ratings"("userId", "variant");
CREATE INDEX "user_variant_ratings_userId_idx" ON "user_variant_ratings"("userId");

ALTER TABLE "user_variant_ratings" ADD CONSTRAINT "user_variant_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable puzzle_user_stats
CREATE TABLE "puzzle_user_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "solvedCount" INTEGER NOT NULL DEFAULT 0,
    "performanceRating" INTEGER NOT NULL DEFAULT 1800,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "radarSkillsJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "puzzle_user_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "puzzle_user_stats_userId_key" ON "puzzle_user_stats"("userId");
CREATE INDEX "puzzle_user_stats_userId_idx" ON "puzzle_user_stats"("userId");

ALTER TABLE "puzzle_user_stats" ADD CONSTRAINT "puzzle_user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable platform_metrics
CREATE TABLE "platform_metrics" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "intValue" INTEGER,
    "strValue" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_metrics_key_key" ON "platform_metrics"("key");

-- CreateTable courses
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");
CREATE INDEX "courses_category_idx" ON "courses"("category");

-- CreateTable course_progress
CREATE TABLE "course_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "bookmarked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "course_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_progress_userId_courseId_key" ON "course_progress"("userId", "courseId");
CREATE INDEX "course_progress_userId_idx" ON "course_progress"("userId");

ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
