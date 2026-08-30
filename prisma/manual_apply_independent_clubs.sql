-- ===========================================================================
-- Independent clubs — a club need not belong to a school.
-- ===========================================================================
--
-- Apply by hand in the Supabase SQL editor, as every migration in this repo is.
-- Idempotent: safe to run twice.
--
-- ORDER MATTERS. Run this file FIRST, then deploy the regenerated Prisma
-- client. Reads are safe in either order; a client that writes
-- `schoolId: null` before this runs gets a NOT NULL violation.
--
-- WHAT THIS DOES, and what it deliberately does not:
--
--   · `clubs."schoolId"` becomes nullable. NULL means an independent club — a
--     town or community club with no host institution. That column is the
--     single source of truth for the distinction; there is deliberately NO
--     `kind` column on `clubs`, because `schoolId IS NULL` already answers the
--     question and a second column beside it would be free to disagree.
--
--   · `club_level` is NOT extended. It means the host institution's education
--     stage (SECONDARY | UNIVERSITY), denormalised from `schools.kind`. A club
--     with no institution has no stage, so a third value would be a category
--     error — and `club_level` is shared with `divisions.level` and
--     `school_enquiries.level`, where "has no school" is meaningless. It would
--     also need `ALTER TYPE ... ADD VALUE`, which this repo has no precedent
--     for and which the Supabase SQL editor cannot run in the same paste as
--     anything that uses the new value.
--
--   · `school_enquiries` DOES get a stored `kind`, unlike `clubs`. An enquiry
--     has no foreign key — only a typed-in name — so there is nothing to
--     derive from. Its `level` becomes nullable at the same time: the old
--     `DEFAULT 'SECONDARY'` filed every school-less enquiry as a secondary
--     school.
--
-- SAFETY against the live data. `ALTER COLUMN ... DROP NOT NULL` is a
-- catalog-only change: it clears pg_attribute.attnotnull, rewrites no rows and
-- takes a brief ACCESS EXCLUSIVE lock. Every existing club keeps its schoolId
-- and stays valid. The foreign key `clubs_schoolId_fkey` needs no change and
-- must NOT be dropped and re-added — NULL is exempt from FK checks, so a
-- nullable column under ON DELETE RESTRICT is legal and the constraint stays
-- valid with no re-validation scan.
--
-- ROLLBACK. Only possible while no independent club exists:
--   UPDATE "clubs" SET "schoolId" = '<some-school-id>' WHERE "schoolId" IS NULL;
--   ALTER TABLE "clubs" ALTER COLUMN "schoolId" SET NOT NULL;
-- Once a real independent club has been created there is no school to point it
-- at, and rolling back means deleting it.
-- ===========================================================================


-- ── 1 · clubs.schoolId becomes nullable ────────────────────────────────────
-- Guarded on information_schema, the same shape as the pg_type and
-- pg_constraint guards the other files in this directory use.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clubs'
          AND column_name = 'schoolId'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "clubs" ALTER COLUMN "schoolId" DROP NOT NULL;
    END IF;
END $$;


-- ── 2 · school_enquiries: a kind, and a level that may be absent ───────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'club_kind') THEN
        CREATE TYPE "club_kind" AS ENUM ('SCHOOL', 'INDEPENDENT');
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Every existing enquiry came through the /for-schools funnel, so SCHOOL is
-- the correct backfill and the DEFAULT makes it free — no UPDATE, no rewrite.
ALTER TABLE "school_enquiries"
    ADD COLUMN IF NOT EXISTS "kind" "club_kind" NOT NULL DEFAULT 'SCHOOL';

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'school_enquiries'
          AND column_name = 'level'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "school_enquiries" ALTER COLUMN "level" DROP NOT NULL;
    END IF;
END $$;


-- ── 3 · An index for the independent roster ────────────────────────────────
-- Partial, because it answers exactly one question — "which clubs have no
-- school?" — and the full-column index already exists for the other direction.
CREATE INDEX IF NOT EXISTS "clubs_independent_idx"
    ON "clubs" ("region")
    WHERE "schoolId" IS NULL;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: clubs.schoolId is_nullable = YES,
--         school_enquiries.kind exists, school_enquiries.level is_nullable = YES,
--         and every existing club still has a school.
--
--   SELECT table_name, column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN
--          (('clubs','schoolId'), ('school_enquiries','level'), ('school_enquiries','kind'));
--
--   SELECT count(*) AS clubs_total,
--          count("schoolId") AS with_school,
--          count(*) - count("schoolId") AS independent
--     FROM "clubs";
