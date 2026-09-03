import { describe, expect, it } from "vitest";
import { graphql } from "graphql";
import type { PrismaClient } from "@prisma/client";
import { schema } from "@/graphql/schema";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { LadderService } from "@/domains/learning/ladder.service";

/**
 * The ladder, end to end: the REAL schema, the REAL resolvers, the REAL
 * service and repository, over an in-memory stand-in for Postgres.
 *
 * The pure merge rules are proved in `domains/learning/ladder.test.ts`. What
 * this file exists for is everything BETWEEN those rules and the database —
 * the part where a correct rule still ships a broken feature:
 *
 *   · A phone flushes a queue, loses the response, and flushes it again. Every
 *     operation here has to be idempotent or a re-sit appears out of nowhere.
 *   · One push carries the same lesson twice. Two `create`s on one unique key
 *     abort the whole transaction, over something that was never a conflict.
 *   · A client asserts its own grade. It must not be able to.
 *   · Somebody asks without a token.
 *
 * The store below is deliberately dumb — arrays and filters — so that a test
 * failing means the code under test is wrong rather than the harness.
 */

const NOW = new Date("2026-09-03T00:00:00Z");

interface LessonRow {
  id: string;
  userId: string;
  lessonId: string;
  tierId: string;
  completedAt: Date;
}
interface ExamRow {
  id: string;
  userId: string;
  attemptId: string;
  examId: string;
  tierId: string;
  scorePoints: number;
  maxPoints: number;
  percent: number;
  grade: string;
  startedAt: Date;
  finishedAt: Date;
  recordedAt: Date;
}
interface DiplomaRow {
  id: string;
  userId: string;
  tierId: string;
  percent: number;
  grade: string;
  earnedAt: Date;
}

function store() {
  const lessons: LessonRow[] = [];
  const exams: ExamRow[] = [];
  const diplomas: DiplomaRow[] = [];
  let seq = 0;
  const id = () => `r${++seq}`;

  const prisma = {
    // The repository hands `$transaction` an array of already-issued
    // operations, exactly as Prisma's array form takes them. The fakes below
    // mutate on call, so this only has to wait for them.
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),

    ladderLessonProgress: {
      findMany: async (args: any) => {
        const where = args?.where ?? {};
        return lessons.filter(
          (row) =>
            row.userId === where.userId &&
            (!where.lessonId?.in || where.lessonId.in.includes(row.lessonId)),
        );
      },
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        lessons.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = lessons.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },

    ladderExamResult: {
      findMany: async (args: any) =>
        exams
          .filter((row) => row.userId === args.where.userId)
          .sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime()),
      findUnique: async ({ where }: any) =>
        exams.find(
          (row) =>
            row.userId === where.userId_attemptId.userId &&
            row.attemptId === where.userId_attemptId.attemptId,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), recordedAt: NOW, ...data };
        exams.push(row);
        return row;
      },
    },

    ladderDiploma: {
      findMany: async (args: any) =>
        diplomas.filter((row) => row.userId === args.where.userId),
      findUnique: async ({ where }: any) =>
        diplomas.find(
          (row) =>
            row.userId === where.userId_tierId.userId &&
            row.tierId === where.userId_tierId.tierId,
        ) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const held = diplomas.find(
          (row) =>
            row.userId === where.userId_tierId.userId &&
            row.tierId === where.userId_tierId.tierId,
        );
        if (held) {
          Object.assign(held, update);
          return held;
        }
        const row = { id: id(), ...create };
        diplomas.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;

  return { prisma, lessons, exams, diplomas };
}

function context(
  prisma: PrismaClient,
  as: { userId?: string } = {},
): GraphQLContextWithServices {
  return {
    user: as.userId ? { userId: as.userId, role: "STUDENT" } : undefined,
    prisma,
    services: { ladderService: new LadderService(prisma) },
  } as unknown as GraphQLContextWithServices;
}

async function run(
  prisma: PrismaClient,
  source: string,
  variableValues?: Record<string, unknown>,
  as: { userId?: string } = { userId: "u1" },
) {
  return graphql({
    schema,
    source,
    contextValue: context(prisma, as),
    variableValues,
  });
}

const PUSH_LESSONS = /* GraphQL */ `
  mutation ($lessons: [LadderLessonInput!]!) {
    recordLadderLessons(lessons: $lessons) {
      lessons { lessonId tierId completedAt }
    }
  }
`;

const PUSH_EXAM = /* GraphQL */ `
  mutation ($input: LadderExamInput!) {
    recordLadderExam(input: $input) {
      exams { attemptId tierId percent grade passed }
      diplomas { tierId percent grade earnedAt }
    }
  }
`;

const MINE = /* GraphQL */ `
  query {
    myLadderProgress {
      lessons { lessonId }
      exams { attemptId }
      diplomas { tierId }
    }
  }
`;

/** One sitting on one morning: `startedAt` moves with `finishedAt`. */
const resit = (attemptId: string, scorePoints: number, day: string) =>
  sitting({
    attemptId,
    scorePoints,
    startedAt: `${day}T10:00:00.000Z`,
    finishedAt: `${day}T10:45:00.000Z`,
  });

const sitting = (over: Record<string, unknown> = {}) => ({
  attemptId: "a1",
  examId: "t01-exam",
  tierId: "tier-01",
  scorePoints: 20,
  maxPoints: 27,
  startedAt: "2026-09-01T10:00:00.000Z",
  finishedAt: "2026-09-01T10:45:00.000Z",
  ...over,
});

// ── Lessons ─────────────────────────────────────────────────────────────────

describe("recording lessons", () => {
  it("records what is new and answers with the whole ladder", async () => {
    const { prisma, lessons } = store();
    const result = await run(prisma, PUSH_LESSONS, {
      lessons: [
        { lessonId: "board-files", tierId: "tier-01", completedAt: "2026-03-04T09:00:00.000Z" },
        { lessonId: "coord-guard", tierId: "tier-01", completedAt: "2026-03-05T09:00:00.000Z" },
      ],
    });
    expect(result.errors).toBeUndefined();
    expect(lessons).toHaveLength(2);
    expect(
      (result.data as any).recordLadderLessons.lessons.map((l: any) => l.lessonId),
    ).toEqual(["board-files", "coord-guard"]);
  });

  it("is a no-op when the same batch arrives twice", async () => {
    // The response was lost, not the write. A queue that flushes again must
    // not double a row or move a date.
    const { prisma, lessons } = store();
    const batch = {
      lessons: [
        { lessonId: "board-files", tierId: "tier-01", completedAt: "2026-03-04T09:00:00.000Z" },
      ],
    };
    await run(prisma, PUSH_LESSONS, batch);
    await run(prisma, PUSH_LESSONS, batch);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].completedAt.toISOString()).toBe("2026-03-04T09:00:00.000Z");
  });

  it("survives one push naming the same lesson twice", async () => {
    // The bug this test exists for: two creates on one unique key abort the
    // whole transaction. The batch is deduplicated before it reaches the
    // database, keeping the earlier claim.
    const { prisma, lessons } = store();
    const result = await run(prisma, PUSH_LESSONS, {
      lessons: [
        { lessonId: "board-files", tierId: "tier-01", completedAt: "2026-05-04T09:00:00.000Z" },
        { lessonId: "board-files", tierId: "tier-01", completedAt: "2026-03-04T09:00:00.000Z" },
      ],
    });
    expect(result.errors).toBeUndefined();
    expect(lessons).toHaveLength(1);
    expect(lessons[0].completedAt.toISOString()).toBe("2026-03-04T09:00:00.000Z");
  });

  it("backdates a lesson a second phone finished earlier, and never forwards", async () => {
    const { prisma, lessons } = store();
    await run(prisma, PUSH_LESSONS, {
      lessons: [{ lessonId: "board-files", tierId: "tier-01", completedAt: "2026-09-01T09:00:00.000Z" }],
    });
    await run(prisma, PUSH_LESSONS, {
      lessons: [{ lessonId: "board-files", tierId: "tier-01", completedAt: "2026-03-04T09:00:00.000Z" }],
    });
    expect(lessons[0].completedAt.toISOString()).toBe("2026-03-04T09:00:00.000Z");

    await run(prisma, PUSH_LESSONS, {
      lessons: [{ lessonId: "board-files", tierId: "tier-01", completedAt: "2026-12-01T09:00:00.000Z" }],
    });
    expect(lessons[0].completedAt.toISOString()).toBe("2026-03-04T09:00:00.000Z");
  });

  it("keeps one student's ladder out of another's", async () => {
    const { prisma } = store();
    await run(
      prisma,
      PUSH_LESSONS,
      { lessons: [{ lessonId: "board-files", tierId: "tier-01", completedAt: "2026-03-04T09:00:00.000Z" }] },
      { userId: "u1" },
    );
    const theirs = await run(prisma, MINE, undefined, { userId: "u2" });
    expect((theirs.data as any).myLadderProgress.lessons).toEqual([]);
  });
});

// ── Exams and the seal ──────────────────────────────────────────────────────

describe("recording an exam", () => {
  it("grades the sitting itself and seals the tier when it passes", async () => {
    const { prisma, diplomas } = store();
    const result = await run(prisma, PUSH_EXAM, { input: sitting() });
    expect(result.errors).toBeUndefined();

    // 20/27 is 74%, which is the top of PASS — one star more would be GOOD.
    const exam = (result.data as any).recordLadderExam.exams[0];
    expect(exam.percent).toBe(74);
    expect(exam.grade).toBe("PASS");
    expect(exam.passed).toBe(true);

    expect(diplomas).toHaveLength(1);
    expect(diplomas[0]).toMatchObject({ tierId: "tier-01", percent: 74, grade: "PASS" });
  });

  it("takes no grade from the client, because it is not offered one", async () => {
    // The input type has no `grade` and no `percent` field, so a client that
    // tries to claim EXCELLENT is refused by the schema before any resolver
    // runs. This is the assertion that fails if somebody "helpfully" adds
    // those fields to LadderExamInput.
    const { prisma } = store();
    const result = await run(prisma, PUSH_EXAM, {
      input: { ...sitting(), grade: "EXCELLENT", percent: 99 },
    });
    expect(result.errors?.[0]?.message).toMatch(/grade|percent|not defined|unknown/i);
  });

  it("does not seal a tier that was failed", async () => {
    const { prisma, diplomas, exams } = store();
    const result = await run(prisma, PUSH_EXAM, {
      input: sitting({ scorePoints: 10 }),
    });
    expect((result.data as any).recordLadderExam.exams[0].grade).toBe("FAIL");
    expect((result.data as any).recordLadderExam.exams[0].passed).toBe(false);
    expect(exams).toHaveLength(1);
    expect(diplomas).toEqual([]);
  });

  it("counts a re-pushed sitting once", async () => {
    const { prisma, exams } = store();
    await run(prisma, PUSH_EXAM, { input: sitting() });
    const again = await run(prisma, PUSH_EXAM, { input: sitting() });
    expect(again.errors).toBeUndefined();
    expect(exams).toHaveLength(1);
    expect((again.data as any).recordLadderExam.exams).toHaveLength(1);
  });

  it("keeps every sitting, and the best seal", async () => {
    const { prisma, exams, diplomas } = store();
    await run(prisma, PUSH_EXAM, { input: resit("a1", 25, "2026-05-01") });
    // A worse re-sit. The history keeps it; the seal does not move.
    await run(prisma, PUSH_EXAM, { input: resit("a2", 17, "2026-09-01") });
    expect(exams).toHaveLength(2);
    expect(diplomas).toHaveLength(1);
    expect(diplomas[0].percent).toBe(93);
    expect(diplomas[0].earnedAt.toISOString()).toBe("2026-05-01T10:45:00.000Z");

    // A better one does move it.
    await run(prisma, PUSH_EXAM, { input: resit("a3", 27, "2026-10-01") });
    expect(diplomas).toHaveLength(1);
    expect(diplomas[0].percent).toBe(100);
    expect(diplomas[0].grade).toBe("EXCELLENT");
  });

  it("refuses a score above the paper", async () => {
    const { prisma, exams } = store();
    const result = await run(prisma, PUSH_EXAM, {
      input: sitting({ scorePoints: 40, maxPoints: 27 }),
    });
    expect(result.errors?.[0]?.message).toMatch(/exceed the paper/i);
    expect(exams).toEqual([]);
  });
});

// ── The door ────────────────────────────────────────────────────────────────

describe("who may ask", () => {
  it("refuses a reader with no token", async () => {
    const { prisma } = store();
    const result = await run(prisma, MINE, undefined, {});
    expect(result.errors?.[0]?.message).toBe("Not authenticated");
    // A throw on a non-null root field nulls the whole response, which is the
    // shape a client actually sees.
    expect(result.data).toBeNull();
  });

  it("refuses a writer with no token", async () => {
    const { prisma, exams } = store();
    const result = await run(prisma, PUSH_EXAM, { input: sitting() }, {});
    expect(result.errors?.[0]?.message).toBe("Not authenticated");
    expect(exams).toEqual([]);
  });

  it("offers no way to ask about somebody else", () => {
    // The access rule is enforced by the surface, not by a check: every
    // operation takes the caller's id from the token, and none takes one as an
    // argument. If a `userId` argument ever appears on any of the three, this
    // fails.
    const query = schema.getQueryType()!.getFields().myLadderProgress;
    expect(query.args).toEqual([]);
    const mutations = schema.getMutationType()!.getFields();
    for (const name of ["recordLadderLessons", "recordLadderExam"]) {
      expect(mutations[name].args.map((a) => a.name)).not.toContain("userId");
    }
  });
});
