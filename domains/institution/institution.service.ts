import type { PrismaClient } from "@prisma/client";
import { TournamentStatus, GameStatus } from "@prisma/client";
import { InstitutionRepository } from "./institution.repository";
import type {
  CreateSchoolDTO,
  UpdateSchoolDTO,
  SchoolStats,
  LeaderboardEntry,
} from "./institution.types";
import { NotFoundError, ValidationError } from "@/utils/types";

export class InstitutionService {
  private institutionRepository: InstitutionRepository;

  constructor(private prisma: PrismaClient) {
    this.institutionRepository = new InstitutionRepository(prisma);
  }

  async createSchool(data: CreateSchoolDTO) {
    if (!data.name?.trim()) throw new ValidationError("School name is required");
    if (!data.region?.trim()) throw new ValidationError("Region is required");
    return this.institutionRepository.create(data);
  }

  async getSchoolById(id: string) {
    const school = await this.institutionRepository.findById(id);
    if (!school) throw new NotFoundError("School not found");
    return school;
  }

  async getAllSchools() {
    return this.institutionRepository.findAll();
  }

  async getSchoolsByRegion(region: string) {
    return this.institutionRepository.findByRegion(region);
  }

  async updateSchool(id: string, data: UpdateSchoolDTO) {
    const school = await this.getSchoolById(id);
    if (!school) throw new NotFoundError("School not found");
    return this.institutionRepository.update(id, data);
  }

  async getSchoolLeaderboard(schoolId: string): Promise<LeaderboardEntry[]> {
    const students =
      await this.institutionRepository.getSchoolStudents(schoolId);

    const leaderboard = await Promise.all(
      students.map(async (student: { id: string; username: string; rating: number; profile: { firstName: string; lastName: string } | null } & Record<string, unknown>) => {
        const gamesCount = await this.prisma.game.count({
          where: {
            OR: [{ whiteId: student.id }, { blackId: student.id }],
            status: GameStatus.COMPLETED,
          },
        });

        return {
          user: student,
          gamesPlayed: gamesCount,
        };
      })
    );

    return leaderboard.sort((a, b) => b.user.rating - a.user.rating);
  }

  async getSchoolStats(schoolId: string): Promise<SchoolStats> {
    const school = await this.getSchoolById(schoolId);
    const totalStudents = school.students.length;

    const averageRating =
      totalStudents > 0
        ? Math.round(
            school.students.reduce(
              (sum: number, s: { rating: number }) => sum + s.rating,
              0
            ) / totalStudents
          )
        : 0;

    const studentIds = school.students.map((s: { id: string }) => s.id);

    const totalGames = await this.prisma.game.count({
      where: {
        OR: [
          { whiteId: { in: studentIds } },
          { blackId: { in: studentIds } },
        ],
        status: GameStatus.COMPLETED,
      },
    });

    const activeTournaments = await this.prisma.tournament.count({
      where: {
        schoolId,
        status: {
          in: [TournamentStatus.UPCOMING, TournamentStatus.ONGOING],
        },
      },
    });

    return {
      totalStudents,
      averageRating,
      totalGames,
      activeTournaments,
    };
  }

  async deleteSchool(id: string) {
    const school = await this.getSchoolById(id);
    if (school.students.length > 0)
      throw new ValidationError("Cannot delete school with registered students");
    return this.institutionRepository.delete(id);
  }
}
