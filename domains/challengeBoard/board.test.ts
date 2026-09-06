import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ChallengeBoardService } from "./challengeBoard.service";

/**
 * The `since` window, pinned at the query level.
 *
 * A filter that silently does not filter is the worst shape this bug could
 * take: the daily page would print an all-time board under a heading that says
 * today, and nothing would look wrong. The calendar is a rotation, so the same
 * position genuinely does come round again — the stale rows would be real
 * results from the last time it appeared.
 */

type Captured = { findMany: unknown[]; count: unknown[] };

function stubPrisma(): { prisma: PrismaClient; captured: Captured } {
  const captured: Captured = { findMany: [], count: [] };
  const prisma = {
    challengeResult: {
      findMany: async (args: unknown) => {
        captured.findMany.push(args);
        return [];
      },
      count: async (args: unknown) => {
        captured.count.push(args);
        return 0;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, captured };
}

const SINCE = new Date("2026-09-06T00:00:00Z");

describe("challengeBoard.board", () => {
  it("applies the window to the ranked wins and to BOTH counts", () => {
    const { prisma, captured } = stubPrisma();
    return new ChallengeBoardService(prisma).board("abc", 20, SINCE).then(() => {
      const wheres = [
        ...captured.findMany.map((a) => (a as { where: Record<string, unknown> }).where),
        ...captured.count.map((a) => (a as { where: Record<string, unknown> }).where),
      ];
      expect(wheres).toHaveLength(3);
      for (const where of wheres) {
        expect(where.scenarioId).toBe("abc");
        // attempts must be windowed too — an all-time attempt count beside a
        // windowed win count reads as "lots of people tried and all failed".
        expect(where.createdAt).toEqual({ gte: SINCE });
      }
    });
  });

  it("omits the window entirely when none is given", () => {
    const { prisma, captured } = stubPrisma();
    return new ChallengeBoardService(prisma).board("abc").then(() => {
      const wheres = [
        ...captured.findMany.map((a) => (a as { where: Record<string, unknown> }).where),
        ...captured.count.map((a) => (a as { where: Record<string, unknown> }).where),
      ];
      for (const where of wheres) {
        expect(where).not.toHaveProperty("createdAt");
      }
    });
  });

  it("clamps limit into range rather than trusting the caller", () => {
    const { prisma, captured } = stubPrisma();
    return new ChallengeBoardService(prisma)
      .board("abc", 9999)
      .then(() => new ChallengeBoardService(prisma).board("abc", -5))
      .then(() => {
        const takes = captured.findMany.map((a) => (a as { take: number }).take);
        expect(takes[0]).toBe(50);
        expect(takes[1]).toBe(1);
      });
  });
});
