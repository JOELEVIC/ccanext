-- Event photo galleries: renditions + curation on activity_images.
-- thumbUrl/width/height describe the pre-sized display rendition so the
-- frontend can lay out a masonry with zero layout shift; highlight marks
-- the curated subset shown on the landing page and feed collages.
--
-- ⚠️ Apply MANUALLY in the Supabase SQL editor (the direct DB host is not
-- reachable from the dev machine), and apply BEFORE deploying this commit:
-- the regenerated Prisma client selects these columns on every activity
-- read, so deploying first would 500 the feed until the columns exist.

ALTER TABLE "activity_images"
  ADD COLUMN IF NOT EXISTS "thumbUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "width" INTEGER,
  ADD COLUMN IF NOT EXISTS "height" INTEGER,
  ADD COLUMN IF NOT EXISTS "highlight" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "activity_images_activityId_highlight_idx"
  ON "activity_images" ("activityId", "highlight");
