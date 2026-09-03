import type { PrismaClient } from "@prisma/client";
import { LadderRepository } from "./ladder.repository";
import {
  MAX_LESSONS_PER_PUSH,
  earlierCompletion,
  examProblem,
  grade as gradeSitting,
  idProblem,
  improvesDiploma,
  type ExamSubmission,
  type LadderProblem,
} from "./ladder";
import { ValidationError } from "@/utils/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The ladder — a student's progress through the app's tiered curriculum.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Android app is offline-first: a student finishes lessons and sits exams
 * against a database on their own phone, and this is where that record is
 * attached to their account so a second phone — or a lost one — does not cost
 * them the ladder they climbed.
 *
 * ── Why every write returns the whole progress ───────────────────────────
 *
 * The app pushes its queue and then pulls, in that order, because a pull that
 * ran first would answer with a server that has not been told yet. Returning
 * the merged state from the mutation collapses those two round trips into one,
 * which on a school's 3G is the difference between a sync and a spinner. The
 * app writes the answer straight into its own tables.
 *
 * ── Idempotence is the contract, not an optimisation ─────────────────────
 *
 * A phone that has been offline flushes a queue it may flush again — the
 * response can be lost after the write landed. So: lessons are keyed on
 * (user, lesson) and only ever backdated, a sitting is keyed on the device's
 * own `attemptId`, and a diploma is the best sitting so far. Pushing the same
 * batch twice changes nothing, and pushing it out of order changes nothing
 * either.
 *
 * ── What is NOT here ─────────────────────────────────────────────────────
 *
 * Reading somebody else's progress. Every method takes the caller's own id
 * from the token and there is no argument to point it at another student. A
 * study record is personal data about a child; a patron seeing their students'
 * work is a real want and a guardian-consent decision (BUILD_PLAN §4.3), not a
 * query to add in passing.
 */
export class LadderService {
  private repository: LadderRepository;

  constructor(private prisma: PrismaClient) {
    this.repository = new LadderRepository(prisma);
  }

  /** Everything this student's ladder consists of. */
  async progressFor(userId: string) {
    const [lessons, exams, diplomas] = await Promise.all([
      this.repository.lessonsFor(userId),
      this.repository.examsFor(userId),
      this.repository.diplomasFor(userId),
    ]);
    return { lessons, exams, diplomas };
  }

  /**
   * Records a batch of finished lessons, and answers with the whole ladder.
   *
   * The batch is deduplicated before it reaches the database, because a phone
   * that finished the same lesson twice in one queue is describing one fact
   * twice — and two `create`s on the same unique key would fail the whole
   * transaction over something that was never a conflict.
   */
  async recordLessons(
    userId: string,
    lessons: Array<{ lessonId: string; tierId: string; completedAt: Date }>,
  ) {
    if (lessons.length > MAX_LESSONS_PER_PUSH) {
      throw new ValidationError(
        `A single push may carry at most ${MAX_LESSONS_PER_PUSH} lessons`,
      );
    }

    const claimed = new Map<
      string,
      { lessonId: string; tierId: string; completedAt: Date }
    >();
    for (const lesson of lessons) {
      for (const id of [lesson.lessonId, lesson.tierId]) {
        const problem = idProblem(id);
        if (problem) throw LadderService.refusal(problem);
      }
      if (Number.isNaN(lesson.completedAt.getTime())) {
        throw new ValidationError("completedAt is not a date");
      }
      const held = claimed.get(lesson.lessonId);
      claimed.set(
        lesson.lessonId,
        held
          ? {
              ...lesson,
              completedAt: earlierCompletion(
                held.completedAt,
                lesson.completedAt,
              ),
            }
          : lesson,
      );
    }

    if (claimed.size > 0) {
      const existing = await this.repository.findLessons(userId, [
        ...claimed.keys(),
      ]);
      const held = new Map(existing.map((row) => [row.lessonId, row]));

      const creates: Array<{
        lessonId: string;
        tierId: string;
        completedAt: Date;
      }> = [];
      const backdates: Array<{ id: string; completedAt: Date }> = [];

      for (const lesson of claimed.values()) {
        const row = held.get(lesson.lessonId);
        if (!row) {
          creates.push(lesson);
          continue;
        }
        // Only when the claim is genuinely earlier. A re-push of the same
        // batch writes nothing, which is the normal case.
        if (lesson.completedAt.getTime() < row.completedAt.getTime()) {
          backdates.push({ id: row.id, completedAt: lesson.completedAt });
        }
      }

      await this.repository.writeLessons(userId, creates, backdates);
    }

    return this.progressFor(userId);
  }

  /**
   * Records one sitting, seals the tier if it earned that, and answers with
   * the whole ladder.
   *
   * The percentage and the grade are computed here from the score, never taken
   * from the input — see the note in `ladder.ts` about what a client is and is
   * not allowed to assert.
   */
  async recordExam(userId: string, sitting: ExamSubmission) {
    const problem = examProblem(sitting);
    if (problem) throw LadderService.refusal(problem);
    for (const at of [sitting.startedAt, sitting.finishedAt]) {
      if (Number.isNaN(at.getTime())) {
        throw new ValidationError("startedAt and finishedAt must be dates");
      }
    }

    // Already have it. The response was lost, not the write — answer with the
    // ladder rather than refusing a client that did the right thing.
    const already = await this.repository.findExamByAttempt(
      userId,
      sitting.attemptId,
    );
    if (already) return this.progressFor(userId);

    const graded = gradeSitting(sitting);

    let seal: { percent: number; grade: typeof graded.grade; earnedAt: Date } | null =
      null;
    if (graded.passed) {
      const held = await this.repository.findDiploma(userId, sitting.tierId);
      const candidate = {
        percent: graded.percent,
        grade: graded.grade,
        earnedAt: sitting.finishedAt,
      };
      if (improvesDiploma(held, candidate)) seal = candidate;
    }

    await this.repository.writeExam(
      userId,
      {
        attemptId: sitting.attemptId,
        examId: sitting.examId,
        tierId: sitting.tierId,
        scorePoints: sitting.scorePoints,
        maxPoints: sitting.maxPoints,
        percent: graded.percent,
        grade: graded.grade,
        startedAt: sitting.startedAt,
        finishedAt: sitting.finishedAt,
      },
      seal,
    );

    return this.progressFor(userId);
  }

  /** One message per problem, in the words a client can act on. */
  private static refusal(problem: LadderProblem): ValidationError {
    switch (problem) {
      case "empty-id":
        return new ValidationError("Ids must not be empty");
      case "id-too-long":
        return new ValidationError("An id is too long");
      case "too-many-lessons":
        return new ValidationError("Too many lessons in one push");
      case "no-max-points":
        return new ValidationError("An exam must be worth more than zero");
      case "negative-score":
        return new ValidationError("A score cannot be negative");
      case "score-above-max":
        return new ValidationError("A score cannot exceed the paper");
      case "finished-before-started":
        return new ValidationError("An exam cannot finish before it starts");
    }
  }
}
