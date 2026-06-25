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

  /** The most recent still-in-play (pending/active), non-tournament game
   *  between two players, in either colour — used to avoid creating duplicate
   *  casual games against the same opponent. */
  async findOpenBetween(userA: string, userB: string) {
    return this.prisma.game.findFirst({
      where: {
        tournamentId: null,
        status: { in: [GameStatus.PENDING, GameStatus.ACTIVE] },
        OR: [
          { whiteId: userA, blackId: userB },
          { whiteId: userB, blackId: userA },
        ],
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
    rated?: boolean;
  }) {
    // Snapshot each player's rating at creation so games-list rows can show the
    // rating you had at the time, not your (later) current rating.
    const [w, b] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: data.whiteId }, select: { rating: true } }),
      this.prisma.user.findUnique({ where: { id: data.blackId }, select: { rating: true } }),
    ]);
    return this.prisma.game.create({
      data: {
        whiteId: data.whiteId,
        blackId: data.blackId,
        timeControl: data.timeControl,
        tournamentId: data.tournamentId,
        rated: data.rated ?? true,
        whiteRating: w?.rating ?? null,
        blackRating: b?.rating ?? null,
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
