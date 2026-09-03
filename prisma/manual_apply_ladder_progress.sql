-- ===========================================================================
-- The ladder — a student's progress through the Android app's tiered
-- curriculum, attached to their account.
--
-- Paste this whole block into the Supabase SQL editor and run it. Idempotent
-- and additive — safe to run more than once, and it touches nothing that
-- already exists.
--
-- NOTE: this Prisma schema does NOT snake_case column names — fields map to
-- their exact camelCase names. So columns are quoted camelCase ("completedAt").
-- ===========================================================================
--
-- WHAT THIS IS FOR
--
-- The app runs its eleven-tier curriculum entirely offline: a student in a
-- school hall with no signal finishes lessons and sits exams against a
-- database on their own phone. Until now that record lived only there, so a
-- lost or replaced phone was a lost ladder. These three tables attach it to
-- the account.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- The phone also holds every drill attempt, the spaced-repetition schedule and
-- the Woodpecker cycle counters — thousands of rows for an active student, all
-- of it training exhaust read only by the device that wrote it. Pushing that
-- over a school's 3G would cost real money and buy nothing a student notices.
-- Lessons, exams and diplomas are what they WOULD notice missing.
--
-- NOT "course_progress"
--
-- That table stays exactly as it is. It is the legacy website's per-course
-- completed/bookmarked flag, keyed on a "courses" row, and it cannot express a
-- lesson inside a tier. Nothing below touches it.


-- ===========================================================================
-- 1) The grade enum — Yusupov's bands, which the app's exams use verbatim
-- ===========================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ladder_exam_grade') THEN
        CREATE TYPE "ladder_exam_grade" AS ENUM ('FAIL', 'PASS', 'GOOD', 'EXCELLENT');
    END IF;
END $$;


-- ===========================================================================
-- 2) Finished lessons
-- ===========================================================================
-- One row per (student, lesson). "completedAt" is held at the EARLIEST claim
-- any device has made: a lesson finished in March on a phone since lost was
-- not finished again in September on a new one.
--
-- "lessonId" and "tierId" are the app's own slugs and are opaque here on
-- purpose — the curriculum ships in the app, and a server that validated them
-- against a list would need redeploying every time a tier gained a lesson.
CREATE TABLE IF NOT EXISTS "ladder_lesson_progress" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "lessonId"    TEXT NOT NULL,
    "tierId"      TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ladder_lesson_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_lesson_progress_userId_lessonId_key"
    ON "ladder_lesson_progress"("userId", "lessonId");
CREATE INDEX IF NOT EXISTS "ladder_lesson_progress_userId_idx"
    ON "ladder_lesson_progress"("userId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ladder_lesson_progress_userId_fkey') THEN
        ALTER TABLE "ladder_lesson_progress" ADD CONSTRAINT "ladder_lesson_progress_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


-- ===========================================================================
-- 3) Sat exams
-- ===========================================================================
-- Append-only: a sitting is something that happened, and keeping the history
-- is what makes a re-sit visible.
--
-- "attemptId" is generated on the device and is the reason a retried push is
-- not a second sitting — a phone that has been offline may flush the same
-- queue twice, or lose the response after the write landed. The unique index
-- on (userId, attemptId) is what makes that harmless.
--
-- "scorePoints" and "maxPoints" are the only two numbers taken on trust; an
-- offline app is the sole witness to its own exam. "percent" and "grade" are
-- computed by the server from them (domains/learning/ladder.ts) and are never
-- accepted from a client, so nobody can claim EXCELLENT with twelve percent.
--
-- "recordedAt" is the server clock, for the support question the other two
-- cannot answer: a sitting dated last March that arrived this morning.
CREATE TABLE IF NOT EXISTS "ladder_exam_results" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "attemptId"   TEXT NOT NULL,
    "examId"      TEXT NOT NULL,
    "tierId"      TEXT NOT NULL,
    "scorePoints" INTEGER NOT NULL,
    "maxPoints"   INTEGER NOT NULL,
    "percent"     INTEGER NOT NULL,
    "grade"       "ladder_exam_grade" NOT NULL,
    "startedAt"   TIMESTAMP(3) NOT NULL,
    "finishedAt"  TIMESTAMP(3) NOT NULL,
    "recordedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ladder_exam_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_exam_results_userId_attemptId_key"
    ON "ladder_exam_results"("userId", "attemptId");
CREATE INDEX IF NOT EXISTS "ladder_exam_results_userId_tierId_idx"
    ON "ladder_exam_results"("userId", "tierId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ladder_exam_results_userId_fkey') THEN
        ALTER TABLE "ladder_exam_results" ADD CONSTRAINT "ladder_exam_results_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


-- ===========================================================================
-- 4) Diplomas — a tier's seal
-- ===========================================================================
-- One row per (student, tier), holding their BEST passing sitting. Written in
-- the same transaction as the exam that earns it, so a seal that exists
-- without an accountable sitting is not a state this can reach.
--
-- A later, worse sitting never lowers it, and a tie on percentage keeps the
-- earlier date: the seal is dated when it was earned, and passing again at the
-- same mark has not moved the day you passed it.
CREATE TABLE IF NOT EXISTS "ladder_diplomas" (
    "id"       TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "tierId"   TEXT NOT NULL,
    "percent"  INTEGER NOT NULL,
    "grade"    "ladder_exam_grade" NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ladder_diplomas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_diplomas_userId_tierId_key"
    ON "ladder_diplomas"("userId", "tierId");
CREATE INDEX IF NOT EXISTS "ladder_diplomas_userId_idx"
    ON "ladder_diplomas"("userId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ladder_diplomas_userId_fkey') THEN
        ALTER TABLE "ladder_diplomas" ADD CONSTRAINT "ladder_diplomas_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;


-- ===========================================================================
-- 5) Row Level Security
-- ===========================================================================
-- Every new table gets RLS ENABLED with NO policies, as
-- manual_apply_clubs_seasons.sql §9 established. The API reaches Postgres as
-- the `postgres` role (BYPASSRLS), so Prisma is unaffected; this shuts the
-- door on Supabase's anon/authenticated PostgREST surface, which nothing in
-- this stack uses.
--
-- It matters more here than for most tables. A study record is personal data
-- about a child — which lessons they have finished, what they scored, how long
-- they took — and it must never be readable with a publishable key. ENABLE is
-- idempotent.
ALTER TABLE "ladder_lesson_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ladder_exam_results"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ladder_diplomas"        ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 6) Verify — run and eyeball. All three tables, one enum, six indexes.
-- ===========================================================================
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('ladder_lesson_progress', 'ladder_exam_results', 'ladder_diplomas')
 ORDER BY table_name;

SELECT unnest(enum_range(NULL::"ladder_exam_grade"))::text AS grade;

SELECT tablename, indexname FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'ladder_%'
 ORDER BY tablename, indexname;
