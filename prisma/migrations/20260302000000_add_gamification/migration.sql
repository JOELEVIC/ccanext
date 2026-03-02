-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastPuzzleSolvedAt" TIMESTAMP(3),
ADD COLUMN "puzzleStreakCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "game_xp_awards" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_xp_awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_xp_awards_gameId_userId_key" ON "game_xp_awards"("gameId", "userId");

-- CreateIndex
CREATE INDEX "game_xp_awards_gameId_idx" ON "game_xp_awards"("gameId");

-- CreateIndex
CREATE INDEX "game_xp_awards_userId_idx" ON "game_xp_awards"("userId");

-- AddForeignKey
ALTER TABLE "game_xp_awards" ADD CONSTRAINT "game_xp_awards_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
