import type { PrismaClient } from "@prisma/client";
import type { PuzzleFilters } from "./learning.types";

export class LearningRepository {
  constructor(private prisma: PrismaClient) {}

  async findPuzzleById(id: string) {
    return this.prisma.puzzle.findUnique({ where: { id } });
  }

  async findPuzzles(filters?: PuzzleFilters) {
    const where: Record<string, unknown> = {};
    if (filters?.difficulty) {
      (where as { difficulty: { gte: number; lte: number } }).difficulty = {
        gte: filters.difficulty - 100,
        lte: filters.difficulty + 100,
      };
    }
    if (filters?.theme) {
      (where as { theme: { has: string } }).theme = { has: filters.theme };
    }

    return this.prisma.puzzle.findMany({
      where,
      orderBy: { difficulty: "asc" },
    });
  }

  async getDailyPuzzle() {
    const count = await this.prisma.puzzle.count();
    const skip = count > 0 ? Math.floor(Math.random() * count) : 0;
    return this.prisma.puzzle.findFirst({ skip });
  }

  async createPuzzle(data: {
    fen: string;
    solution: string;
    difficulty: number;
    theme: string[];
  }) {
    return this.prisma.puzzle.create({ data });
  }

  async createBadge(data: {
    profileId: string;
    name: string;
    description: string;
  }) {
    return this.prisma.badge.create({
      data,
      include: { profile: true },
    });
  }

  async getUserBadges(profileId: string) {
    return this.prisma.badge.findMany({
      where: { profileId },
      orderBy: { earnedAt: "desc" },
    });
  }
}
