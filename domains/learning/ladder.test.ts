import { describe, expect, it } from "vitest";
import {
  earlierCompletion,
  examProblem,
  grade,
  gradeFor,
  idProblem,
  improvesDiploma,
  MAX_ID_LENGTH,
  passed,
  percentFor,
  type ExamSubmission,
} from "./ladder";

/**
 * The band boundaries and the merge rules, at the values where being wrong
 * costs a student something.
 *
 * The boundaries matter because they are the difference between repeating a
 * chapter and moving on, and the merge rules matter because they are what lets
 * two phones sync without asking anybody which one was right.
 */

const sitting = (over: Partial<ExamSubmission> = {}): ExamSubmission => ({
  attemptId: "a1",
  examId: "t01-exam",
  tierId: "tier-01",
  scorePoints: 20,
  maxPoints: 27,
  startedAt: new Date("2026-09-01T10:00:00Z"),
  finishedAt: new Date("2026-09-01T10:45:00Z"),
  ...over,
});

describe("the bands", () => {
  it("puts each boundary on the generous side of the line", () => {
    // Every one of these is a value somebody will actually score, and each is
    // the first score in its band. 59 fails and 60 passes; a test that only
    // checked 50 and 95 would pass with the comparisons written backwards.
    expect(gradeFor(59)).toBe("FAIL");
    expect(gradeFor(60)).toBe("PASS");
    expect(gradeFor(74)).toBe("PASS");
    expect(gradeFor(75)).toBe("GOOD");
    expect(gradeFor(89)).toBe("GOOD");
    expect(gradeFor(90)).toBe("EXCELLENT");
  });

  it("treats every band but FAIL as a pass", () => {
    expect(passed("FAIL")).toBe(false);
    expect(passed("PASS")).toBe(true);
    expect(passed("GOOD")).toBe(true);
    expect(passed("EXCELLENT")).toBe(true);
  });

  it("rounds a half star up, because the student earned it", () => {
    // 16/27 is 59.26 and fails; 16.5 would be 61. The case that matters is a
    // score landing exactly on .5 — a floor there fails somebody by arithmetic
    // rather than by the exam.
    expect(percentFor(16, 27)).toBe(59);
    expect(percentFor(1, 2)).toBe(50);
    expect(percentFor(3, 8)).toBe(38); // 37.5 → 38
    expect(percentFor(59.5, 100)).toBe(60);
    expect(gradeFor(percentFor(59.5, 100))).toBe("PASS");
  });

  it("answers zero rather than dividing by it", () => {
    expect(percentFor(0, 0)).toBe(0);
    expect(percentFor(5, 0)).toBe(0);
  });
});

describe("grading a sitting", () => {
  it("derives the percentage and the band from the score alone", () => {
    // The input carries no grade, which is the point: a client cannot claim
    // EXCELLENT with twelve percent because it is never asked what it scored
    // out of a hundred, only how many stars it took.
    expect(grade(sitting({ scorePoints: 27, maxPoints: 27 }))).toEqual({
      percent: 100,
      grade: "EXCELLENT",
      passed: true,
    });
    expect(grade(sitting({ scorePoints: 10, maxPoints: 27 }))).toEqual({
      percent: 37,
      grade: "FAIL",
      passed: false,
    });
  });
});

describe("what a sitting must look like", () => {
  it("accepts an ordinary one", () => {
    expect(examProblem(sitting())).toBeNull();
  });

  it("allows a sitting that started and finished in the same instant", () => {
    // A clock with one-second resolution can legitimately report the same
    // instant twice, and refusing that would reject real submissions.
    const at = new Date("2026-09-01T10:00:00Z");
    expect(examProblem(sitting({ startedAt: at, finishedAt: at }))).toBeNull();
  });

  it("refuses a sitting that finished before it started", () => {
    expect(
      examProblem(
        sitting({
          startedAt: new Date("2026-09-01T11:00:00Z"),
          finishedAt: new Date("2026-09-01T10:00:00Z"),
        }),
      ),
    ).toBe("finished-before-started");
  });

  it("refuses a score above the paper, or below zero", () => {
    expect(examProblem(sitting({ scorePoints: 28, maxPoints: 27 }))).toBe(
      "score-above-max",
    );
    expect(examProblem(sitting({ scorePoints: -1 }))).toBe("negative-score");
  });

  it("refuses an exam worth nothing", () => {
    expect(examProblem(sitting({ maxPoints: 0 }))).toBe("no-max-points");
  });

  it("refuses an empty or oversized id", () => {
    expect(examProblem(sitting({ attemptId: "  " }))).toBe("empty-id");
    expect(examProblem(sitting({ tierId: "x".repeat(MAX_ID_LENGTH + 1) }))).toBe(
      "id-too-long",
    );
    expect(idProblem("x".repeat(MAX_ID_LENGTH))).toBeNull();
  });
});

describe("merging, which only ever adds", () => {
  it("keeps the earlier date a lesson was finished", () => {
    const march = new Date("2026-03-04T09:00:00Z");
    const september = new Date("2026-09-03T09:00:00Z");
    expect(earlierCompletion(september, march)).toEqual(march);
    expect(earlierCompletion(march, september)).toEqual(march);
  });

  it("seals a tier the first time it is passed", () => {
    expect(
      improvesDiploma(null, {
        percent: 62,
        grade: "PASS",
        earnedAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("upgrades a seal on a better sitting and never downgrades it", () => {
    const held = {
      percent: 80,
      grade: "GOOD" as const,
      earnedAt: new Date("2026-05-01T00:00:00Z"),
    };
    expect(
      improvesDiploma(held, {
        percent: 92,
        grade: "EXCELLENT",
        earnedAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(true);
    // The case that matters. A student who passes at 80 and then scrapes 62 on
    // a re-sit has not lost their GOOD.
    expect(
      improvesDiploma(held, {
        percent: 62,
        grade: "PASS",
        earnedAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("backdates a tie, so re-pushing an old sitting is a no-op", () => {
    // Two phones both hold the sitting that earned the seal. The second push
    // must not move the date forward — and pushing the same one twice must
    // change nothing at all.
    const held = {
      percent: 80,
      grade: "GOOD" as const,
      earnedAt: new Date("2026-05-01T00:00:00Z"),
    };
    expect(
      improvesDiploma(held, { ...held, earnedAt: new Date("2026-09-01T00:00:00Z") }),
    ).toBe(false);
    expect(improvesDiploma(held, { ...held })).toBe(false);
    expect(
      improvesDiploma(held, { ...held, earnedAt: new Date("2026-01-01T00:00:00Z") }),
    ).toBe(true);
  });
});
