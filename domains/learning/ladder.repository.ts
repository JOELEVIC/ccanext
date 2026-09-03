import type { PrismaClient, LadderExamGrade } from "@prisma/client";

/**
 * Prisma access for the ladder. No rules here — those are in `ladder.ts`,
 * which has no database in it, and in `ladder.service.ts`, which decides.
 */
export class LadderRepository {
  constructor(private prisma: PrismaClient) {}

  async lessonsFor(userId: string) {
    return this.prisma.ladderLessonProgress.findMany({
      where: { userId },
      orderBy: [{ tierId: "asc" }, { lessonId: "asc" }],
    });
  }

  async examsFor(userId: string) {
    return this.prisma.ladderExamResult.findMany({
      where: { userId },
      orderBy: { finishedAt: "asc" },
    });
  }

  async diplomasFor(userId: string) {
    return this.prisma.ladderDiploma.findMany({
      where: { userId },
      orderBy: { tierId: "asc" },
    });
  }

  async findLessons(userId: string, lessonIds: string[]) {
    return this.prisma.ladderLessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds } },
    });
  }

  /**
   * Writes one batch of lesson completions in a single transaction.
   *
   * `create` for the ones this student has never finished, `update` only for
   * the ones whose recorded date is later than the incoming claim — so a push
   * that says nothing new costs no writes at all, which is the normal case for
   * a phone that syncs every time it sees signal.
   */
  async writeLessons(
    userId: string,
    creates: Array<{ lessonId: string; tierId: string; completedAt: Date }>,
    backdates: Array<{ id: string; completedAt: Date }>,
  ) {
    if (creates.length === 0 && backdates.length === 0) return;
    await this.prisma.$transaction([
      ...creates.map((row) =>
        this.prisma.ladderLessonProgress.create({ data: { userId, ...row } }),
      ),
      ...backdates.map((row) =>
        this.prisma.ladderLessonProgress.update({
          where: { id: row.id },
          data: { completedAt: row.completedAt },
        }),
      ),
    ]);
  }

  async findExamByAttempt(userId: string, attemptId: string) {
    return this.prisma.ladderExamResult.findUnique({
      where: { userId_attemptId: { userId, attemptId } },
    });
  }

  async findDiploma(userId: string, tierId: string) {
    return this.prisma.ladderDiploma.findUnique({
      where: { userId_tierId: { userId, tierId } },
    });
  }

  /**
   * The sitting and, when it earns one, the seal — in one transaction.
   *
   * Together on purpose: a diploma that exists without the exam that earned it
   * is a seal nobody can account for, and an exam that passed without sealing
   * its tier is a student who was told they failed by the map.
   */
  async writeExam(
    userId: string,
    exam: {
      attemptId: string;
      examId: string;
      tierId: string;
      scorePoints: number;
      maxPoints: number;
      percent: number;
      grade: LadderExamGrade;
      startedAt: Date;
      finishedAt: Date;
    },
    seal: { percent: number; grade: LadderExamGrade; earnedAt: Date } | null,
  ) {
    await this.prisma.$transaction([
      this.prisma.ladderExamResult.create({ data: { userId, ...exam } }),
      ...(seal
        ? [
            this.prisma.ladderDiploma.upsert({
              where: { userId_tierId: { userId, tierId: exam.tierId } },
              create: { userId, tierId: exam.tierId, ...seal },
              update: seal,
            }),
          ]
        : []),
    ]);
  }
}
