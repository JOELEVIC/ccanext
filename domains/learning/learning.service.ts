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

  async checkSolution(
    data: CheckSolutionDTO
  ): Promise<{ correct: boolean; solution: string }> {
    const puzzle = await this.getPuzzleById(data.puzzleId);
    const normalizedSolution = puzzle.solution.trim().toLowerCase();
    const normalizedUserSolution = data.userSolution.trim().toLowerCase();
    const correct = normalizedSolution === normalizedUserSolution;
    return { correct, solution: puzzle.solution };
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
