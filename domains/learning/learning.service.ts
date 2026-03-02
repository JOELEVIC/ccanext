import type { PrismaClient } from "@prisma/client";
import { LearningRepository } from "./learning.repository";
import type {
  CreatePuzzleDTO,
  PuzzleFilters,
  CheckSolutionDTO,
  BadgeDTO,
} from "./learning.types";
import { NotFoundError, ValidationError } from "@/utils/types";

export class LearningService {
  private learningRepository: LearningRepository;

  constructor(private prisma: PrismaClient) {
    this.learningRepository = new LearningRepository(prisma);
  }

  async getDailyPuzzle() {
    const puzzle = await this.learningRepository.getDailyPuzzle();
    if (!puzzle) throw new NotFoundError("No puzzles available");
    return puzzle;
  }

  async getPuzzles(filters?: PuzzleFilters) {
    return this.learningRepository.findPuzzles(filters);
  }

  async getPuzzleById(id: string) {
    const puzzle = await this.learningRepository.findPuzzleById(id);
    if (!puzzle) throw new NotFoundError("Puzzle not found");
    return puzzle;
  }

  async createPuzzle(data: CreatePuzzleDTO) {
    if (!data.fen || data.fen.split(" ").length < 4)
      throw new ValidationError("Invalid FEN format");
    if (data.difficulty < 0 || data.difficulty > 3000)
      throw new ValidationError("Difficulty must be between 0 and 3000");
    return this.learningRepository.createPuzzle(data);
  }

  /** XP per correct solve: base 10 + bonus from difficulty (e.g. +1 per 200 rating) */
  private static xpForPuzzle(difficulty: number): number {
    return 10 + Math.floor(difficulty / 200);
  }

  /** Compare dates by calendar day (UTC). */
  private static isSameDay(a: Date | null, b: Date): boolean {
    if (!a) return false;
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  /** Returns true if a is the day before b (UTC). */
  private static isYesterday(a: Date | null, b: Date): boolean {
    if (!a) return false;
    const prev = new Date(b);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return LearningService.isSameDay(a, prev);
  }

  async checkSolution(
    data: CheckSolutionDTO,
    userId: string | null
  ): Promise<{
    correct: boolean;
    solution: string;
    xpAwarded?: number;
    streakAfter?: number;
  }> {
    const puzzle = await this.getPuzzleById(data.puzzleId);
    const normalizedSolution = puzzle.solution.trim().toLowerCase();
    const normalizedUserSolution = data.userSolution.trim().toLowerCase();
    const correct = normalizedSolution === normalizedUserSolution;

    let xpAwarded: number | undefined;
    let streakAfter: number | undefined;

    if (correct && userId) {
      const profile = await this.prisma.profile.findFirst({
        where: { userId },
      });
      if (profile) {
        const now = new Date();
        const xpGain = LearningService.xpForPuzzle(puzzle.difficulty);
        let newStreak = profile.puzzleStreakCount;
        if (LearningService.isSameDay(profile.lastPuzzleSolvedAt, now)) {
          // Already solved today: no streak change, still award XP (allow multiple puzzles per day)
        } else if (LearningService.isYesterday(profile.lastPuzzleSolvedAt, now)) {
          newStreak = profile.puzzleStreakCount + 1;
        } else {
          newStreak = 1;
        }
        await this.prisma.profile.update({
          where: { id: profile.id },
          data: {
            xp: profile.xp + xpGain,
            lastPuzzleSolvedAt: now,
            puzzleStreakCount: newStreak,
          },
        });
        xpAwarded = xpGain;
        streakAfter = newStreak;
      }
    }

    return {
      correct,
      solution: puzzle.solution,
      xpAwarded,
      streakAfter,
    };
  }

  async awardBadge(data: BadgeDTO) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: data.profileId },
    });
    if (!profile) throw new NotFoundError("Profile not found");
    return this.learningRepository.createBadge(data);
  }

  async getUserBadges(profileId: string) {
    return this.learningRepository.getUserBadges(profileId);
  }
}
