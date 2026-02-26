import type { PrismaClient } from "@prisma/client";
import { GameStatus, GameResult } from "@prisma/client";
import type { GameFilters } from "./game.types";

export class GameRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.game.findUnique({
      where: { id },
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
        tournament: true,
      },
    });
  }

  async findMany(filters?: GameFilters) {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.tournamentId) where.tournamentId = filters.tournamentId;
    if (filters?.userId) {
      (where as { OR: unknown[] }).OR = [
        { whiteId: filters.userId },
        { blackId: filters.userId },
      ];
    }

    return this.prisma.game.findMany({
      where,
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
        tournament: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveGames() {
    return this.prisma.game.findMany({
      where: { status: GameStatus.ACTIVE },
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findUserGames(userId: string, status?: GameStatus) {
    return this.prisma.game.findMany({
      where: {
        OR: [{ whiteId: userId }, { blackId: userId }],
        ...(status && { status }),
      },
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
        tournament: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    whiteId: string;
    blackId: string;
    timeControl: string;
    tournamentId?: string;
  }) {
    return this.prisma.game.create({
      data: {
        whiteId: data.whiteId,
        blackId: data.blackId,
        timeControl: data.timeControl,
        tournamentId: data.tournamentId,
        moves: "",
        status: GameStatus.PENDING,
      },
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
      },
    });
  }

  async update(
    id: string,
    data: { moves?: string; status?: GameStatus; result?: GameResult }
  ) {
    return this.prisma.game.update({
      where: { id },
      data,
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
        tournament: true,
      },
    });
  }

  async delete(id: string) {
    return this.prisma.game.delete({ where: { id } });
  }
}
