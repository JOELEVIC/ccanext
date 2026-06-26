import type { PrismaClient } from "@prisma/client";
import type { TournamentStatus } from "@prisma/client";
import type { TournamentFilters } from "./tournament.types";

export class TournamentRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.tournament.findUnique({
      where: { id },
      include: {
        school: true,
        participants: {
          include: {
            user: { include: { profile: true } },
          },
        },
        games: {
          include: {
            white: { include: { profile: true } },
            black: { include: { profile: true } },
          },
        },
      },
    });
  }

  async findMany(filters?: TournamentFilters) {
    const where: Record<string, unknown> = {};
    if (filters?.schoolId) where.schoolId = filters.schoolId;
    if (filters?.status) where.status = filters.status;

    return this.prisma.tournament.findMany({
      where,
      include: {
        school: true,
        participants: {
          include: {
            user: { include: { profile: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });
  }

  async findBySchoolId(schoolId: string) {
    return this.prisma.tournament.findMany({
      where: { schoolId },
      include: {
        school: true,
        participants: { include: { user: true } },
      },
      orderBy: { startDate: "desc" },
    });
  }

  async create(data: {
    name: string;
    schoolId: string;
    startDate: Date;
    endDate?: Date;
  }) {
    return this.prisma.tournament.create({
      data,
      include: { school: true },
    });
  }

  /** Admin create with full configuration; unset optional fields fall back to
   *  the schema defaults (ARENA / 450 / 3+0 / BUCHHOLZ / rated). */
  async createFull(data: {
    name: string;
    schoolId: string;
    startDate: Date;
    endDate?: Date;
    format?: string;
    maxPlayers?: number;
    durationMinutes?: number;
    chessVariant?: string;
    arenaTimeControl?: string;
    totalRounds?: number;
    tiebreak?: string;
    isRated?: boolean;
  }) {
    return this.prisma.tournament.create({
      data: {
        name: data.name,
        schoolId: data.schoolId,
        startDate: data.startDate,
        endDate: data.endDate,
        ...(data.format ? { format: data.format } : {}),
        ...(data.maxPlayers != null ? { maxPlayers: data.maxPlayers } : {}),
        ...(data.durationMinutes != null ? { durationMinutes: data.durationMinutes } : {}),
        ...(data.chessVariant ? { chessVariant: data.chessVariant } : {}),
        ...(data.arenaTimeControl ? { arenaTimeControl: data.arenaTimeControl } : {}),
        ...(data.totalRounds != null ? { totalRounds: data.totalRounds } : {}),
        ...(data.tiebreak ? { tiebreak: data.tiebreak } : {}),
        ...(data.isRated != null ? { isRated: data.isRated } : {}),
      },
      include: {
        school: true,
        participants: { include: { user: { include: { profile: true } } } },
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      startDate?: Date;
      endDate?: Date;
      status?: TournamentStatus;
    }
  ) {
    return this.prisma.tournament.update({
      where: { id },
      data,
      include: {
        school: true,
        participants: { include: { user: true } },
      },
    });
  }

  async addParticipant(tournamentId: string, userId: string) {
    return this.prisma.tournamentParticipant.create({
      data: { tournamentId, userId },
      include: {
        user: { include: { profile: true } },
      },
    });
  }

  async removeParticipant(tournamentId: string, userId: string) {
    return this.prisma.tournamentParticipant.delete({
      where: {
        tournamentId_userId: { tournamentId, userId },
      },
    });
  }

  async updateParticipantScore(
    tournamentId: string,
    userId: string,
    score: number
  ) {
    return this.prisma.tournamentParticipant.update({
      where: {
        tournamentId_userId: { tournamentId, userId },
      },
      data: { score },
    });
  }

  async delete(id: string) {
    return this.prisma.tournament.delete({ where: { id } });
  }
}
