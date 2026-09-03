/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The ladder — the arithmetic of the tiered curriculum, with no database in it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Android app carries an eleven-tier learning ladder (100–500 through
 * 2900–3100) and works entirely offline: a student in a school hall with no
 * signal finishes lessons, sits an exam and earns a diploma against a database
 * on their own phone. This module holds the rules that decide what any of that
 * is worth, so that they live in one place, are unit-tested, and are the
 * SERVER'S rules rather than whatever a client asserts.
 *
 * ── What the client is allowed to say, and what it is not ────────────────
 *
 * A phone that has been offline for a week is the only witness to what
 * happened on it, so `scorePoints` and `maxPoints` have to be taken on trust —
 * there is no honest alternative for an offline product. Everything *derived*
 * from them is not taken on trust. A client cannot claim EXCELLENT with twelve
 * percent, because the grade is computed here from the score it reported and
 * the input carries no grade at all.
 *
 * That is the whole integrity story and it is deliberately modest. This is a
 * school's study record, not a rating: the national rating comes from played
 * games through `PlayerRating`, and nothing in this file touches it.
 *
 * ── Why the bands are these bands ────────────────────────────────────────
 *
 * They are Yusupov's, used verbatim by the app's exams: under 60 is a fail and
 * the chapter is repeated, 60–74 passes, 75–89 is good, 90 and over is
 * excellent. Copying them here rather than inventing a curve means the server
 * and the phone agree about a sitting without either having to ask.
 *
 * ── Progress only accumulates ────────────────────────────────────────────
 *
 * Every merge rule below is monotone, which is what lets two phones sync
 * without a conflict protocol. A lesson finished anywhere is finished; a
 * sitting is a fact that happened; a diploma is the best sitting so far. There
 * is no operation in this domain that takes progress away, so "which device
 * won" is never a question that has to be answered.
 */

/** Yusupov's bands, verbatim. */
export type ExamGrade = "FAIL" | "PASS" | "GOOD" | "EXCELLENT";

/** The most lessons one push may carry. The whole ladder is ~220. */
export const MAX_LESSONS_PER_PUSH = 500;

/** The longest an id may be. Lesson ids are slugs like `coord-guard`. */
export const MAX_ID_LENGTH = 64;

/**
 * A sitting's percentage, rounded the way the app rounds it.
 *
 * `Math.round` rather than a floor: 59.5% of the stars is 60%, and a student
 * who is told they failed by half a star they did earn has been failed by the
 * arithmetic rather than by the exam.
 */
export function percentFor(scorePoints: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  return Math.round((100 * scorePoints) / maxPoints);
}

/** The band a percentage falls in. */
export function gradeFor(percent: number): ExamGrade {
  if (percent >= 90) return "EXCELLENT";
  if (percent >= 75) return "GOOD";
  if (percent >= 60) return "PASS";
  return "FAIL";
}

/** Passing is not failing. One definition, so the two can never disagree. */
export function passed(grade: ExamGrade): boolean {
  return grade !== "FAIL";
}

/**
 * When a lesson was finished, given two claims about it.
 *
 * The earlier one. A student who finished the pawn lesson in March on a phone
 * they have since lost did not finish it again in September on a new one, and
 * the record should say March.
 */
export function earlierCompletion(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export interface DiplomaClaim {
  percent: number;
  grade: ExamGrade;
  earnedAt: Date;
}

/**
 * Whether a passing sitting improves on the tier's existing seal.
 *
 * Best percentage wins. A tie keeps the EARLIER date, because the seal is
 * dated when it was earned and re-sitting an exam you have already passed at
 * the same mark has not moved the day you passed it.
 *
 * Returns false when there is no improvement, so the caller can skip the
 * write entirely — which is what makes re-pushing an old sitting a no-op.
 */
export function improvesDiploma(
  existing: DiplomaClaim | null,
  candidate: DiplomaClaim,
): boolean {
  if (!existing) return true;
  if (candidate.percent > existing.percent) return true;
  if (candidate.percent < existing.percent) return false;
  return candidate.earnedAt.getTime() < existing.earnedAt.getTime();
}

/** Why a submission was refused. Each maps to one `ValidationError` message. */
export type LadderProblem =
  | "empty-id"
  | "id-too-long"
  | "too-many-lessons"
  | "no-max-points"
  | "negative-score"
  | "score-above-max"
  | "finished-before-started";

/**
 * Checks one id the client chose: a lesson id, a tier id, an exam id, an
 * attempt id.
 *
 * These are opaque to the server — the curriculum lives in the app, and a
 * server that validated lesson ids against a list would need shipping every
 * time a tier gained a lesson. What it does insist on is that an id is a
 * non-empty string of sane length, so a row cannot be keyed on "" or on a
 * megabyte of text.
 */
export function idProblem(id: string): LadderProblem | null {
  if (id.trim().length === 0) return "empty-id";
  if (id.length > MAX_ID_LENGTH) return "id-too-long";
  return null;
}

export interface ExamSubmission {
  attemptId: string;
  examId: string;
  tierId: string;
  scorePoints: number;
  maxPoints: number;
  startedAt: Date;
  finishedAt: Date;
}

/** Everything wrong with a sitting, or null. First problem wins. */
export function examProblem(sitting: ExamSubmission): LadderProblem | null {
  for (const id of [
    sitting.attemptId,
    sitting.examId,
    sitting.tierId,
  ]) {
    const problem = idProblem(id);
    if (problem) return problem;
  }
  if (sitting.maxPoints <= 0) return "no-max-points";
  if (sitting.scorePoints < 0) return "negative-score";
  if (sitting.scorePoints > sitting.maxPoints) return "score-above-max";
  // Equal is allowed: an exam answered in under a millisecond is implausible
  // rather than impossible, and a clock with one-second resolution can
  // legitimately report the same instant twice.
  if (sitting.finishedAt.getTime() < sitting.startedAt.getTime()) {
    return "finished-before-started";
  }
  return null;
}

/** The graded form of a sitting, derived rather than accepted. */
export interface GradedExam {
  percent: number;
  grade: ExamGrade;
  passed: boolean;
}

export function grade(sitting: ExamSubmission): GradedExam {
  const percent = percentFor(sitting.scorePoints, sitting.maxPoints);
  const band = gradeFor(percent);
  return { percent, grade: band, passed: passed(band) };
}
