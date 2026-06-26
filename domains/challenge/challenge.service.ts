import type { PrismaClient } from "@prisma/client";
import { ChallengeStatus, GameStatus } from "@prisma/client";
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from "@/utils/types";
import { GameRepository } from "../game/game.repository";

/** Open challenges auto-expire after this long. */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

const COLORS = ["white", "black", "random"] as const;

export class ChallengeService {
  private gameRepository: GameRepository;

  constructor(private prisma: PrismaClient) {
    this.gameRepository = new GameRepository(prisma);
  }

  private include = {
    creator: { include: { profile: true } },
    opponent: { include: { profile: true } },
    game: true,
  };

  async createChallenge(data: {
    creatorId: string;
    opponentId?: string | null;
    creatorColor: string;
    timeControl: string;
    rated: boolean;
  }) {
    const color = (COLORS as readonly string[]).includes(data.creatorColor)
      ? data.creatorColor
      : "random";

    if (!/^\d+\+\d+$/.test(data.timeControl))
      throw new ValidationError(
        'Invalid time control. Use format: "minutes+increment"'
      );

    let gameId: string | null = null;

    if (data.opponentId) {
      if (data.opponentId === data.creatorId)
        throw new ValidationError("You can't challenge yourself");
      const opp = await this.prisma.user.findUnique({
        where: { id: data.opponentId },
      });
      if (!opp) throw new ValidationError("Opponent not found");

      // Dedupe — never stack multiple live challenges on the same person.
      // Re-sending just returns the existing one (and its game), so the
      // challenger lands back in the same waiting game.
      const existing = await this.prisma.challenge.findFirst({
        where: {
          status: ChallengeStatus.OPEN,
          creatorId: data.creatorId,
          opponentId: data.opponentId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: this.include,
      });
      if (existing) return existing;

      // Direct challenge: both players are known, so create the game up-front
      // (PENDING). The challenger is dropped straight into it to wait; the
      // opponent joins the very same game when they accept.
      const resolved = color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
      const whiteId = resolved === "white" ? data.creatorId : data.opponentId;
      const blackId = resolved === "white" ? data.opponentId : data.creatorId;
      const game = await this.gameRepository.create({
        whiteId,
        blackId,
        timeControl: data.timeControl,
        rated: data.rated,
      });
      gameId = game.id;
    }

    return this.prisma.challenge.create({
      data: {
        creatorId: data.creatorId,
        opponentId: data.opponentId ?? null,
        creatorColor: color,
        timeControl: data.timeControl,
        rated: data.rated,
        status: ChallengeStatus.OPEN,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        gameId,
      },
      include: this.include,
    });
  }

  /** Accept an open challenge: create the game (colors resolved), link it, return the game. */
  async acceptChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");

    // Idempotent: if it's already been accepted, hand back the existing game.
    if (ch.status === ChallengeStatus.ACCEPTED && ch.gameId) {
      return this.gameRepository.findById(ch.gameId);
    }
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    if (ch.expiresAt && ch.expiresAt.getTime() < Date.now()) {
      await this.prisma.challenge.update({
        where: { id: challengeId },
        data: { status: ChallengeStatus.EXPIRED },
      });
      throw new ValidationError("This challenge has expired");
    }
    if (userId === ch.creatorId)
      throw new ValidationError("You can't accept your own challenge");
    if (ch.opponentId && ch.opponentId !== userId)
      throw new AuthorizationError("This challenge isn't addressed to you");

    // Direct challenges already have a PENDING game with both players assigned —
    // just join it. Open invites have no game yet, so create it now.
    let gameId = ch.gameId;
    if (!gameId) {
      const color =
        ch.creatorColor === "random"
          ? Math.random() < 0.5
            ? "white"
            : "black"
          : ch.creatorColor;
      const whiteId = color === "white" ? ch.creatorId : userId;
      const blackId = color === "white" ? userId : ch.creatorId;
      const game = await this.gameRepository.create({
        whiteId,
        blackId,
        timeControl: ch.timeControl,
        rated: ch.rated,
      });
      gameId = game.id;
    }

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        status: ChallengeStatus.ACCEPTED,
        opponentId: userId,
        gameId,
      },
    });

    return this.gameRepository.findById(gameId);
  }

  async declineChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    if (ch.opponentId !== userId)
      throw new AuthorizationError("This challenge isn't addressed to you");
    await this.abandonPendingGame(ch.gameId);
    return this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.DECLINED },
      include: this.include,
    });
  }

  /** End the up-front game if the challenge is rejected/cancelled before play. */
  private async abandonPendingGame(gameId: string | null) {
    if (!gameId) return;
    await this.prisma.game.updateMany({
      where: { id: gameId, status: GameStatus.PENDING },
      data: { status: GameStatus.ABANDONED },
    });
  }

  async cancelChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");
    if (ch.creatorId !== userId)
      throw new AuthorizationError("Only the creator can cancel this challenge");
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    await this.abandonPendingGame(ch.gameId);
    return this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.CANCELLED },
      include: this.include,
    });
  }

  async getChallenge(challengeId: string) {
    return this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: this.include,
    });
  }

  /** Open challenges that involve me — ones I sent and ones addressed to me. */
  async myChallenges(userId: string) {
    return this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.OPEN,
        OR: [{ opponentId: userId }, { creatorId: userId }],
      },
      include: this.include,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Public open invites (no named opponent) anyone can accept — excluding my own. */
  async openChallenges(userId?: string) {
    return this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.OPEN,
        opponentId: null,
        ...(userId ? { creatorId: { not: userId } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: this.include,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
}
