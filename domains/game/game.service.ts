import type { PrismaClient } from "@prisma/client";
import { GameStatus, GameResult } from "@prisma/client";
import { GameRepository } from "./game.repository";
import type { CreateGameDTO, MakeMoveDTO, GameFilters } from "./game.types";
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from "@/utils/types";
import { UserService } from "../user/user.service";
import { glicko2Update, DEFAULT_RD, DEFAULT_VOL } from "./glicko2";

const XP_WIN = 20;
const XP_DRAW = 10;
const XP_LOSS = 5;

/** Glicko float rating → the clamped integer mirrored on users.rating for display. */
function toDisplayRating(rating: number): number {
  return Math.max(0, Math.min(3000, Math.round(rating)));
}

export class GameService {
  private gameRepository: GameRepository;
  private userService: UserService;

  constructor(private prisma: PrismaClient) {
    this.gameRepository = new GameRepository(prisma);
    this.userService = new UserService(prisma);
  }

  async createGame(data: CreateGameDTO) {
    const white = await this.userService.getUserById(data.whiteId);
    const black = await this.userService.getUserById(data.blackId);

    if (!white || !black) throw new ValidationError("Invalid player IDs");
    if (data.whiteId === data.blackId)
      throw new ValidationError("Players cannot play against themselves");

    const timeControlRegex = /^\d+\+\d+$/;
    if (!timeControlRegex.test(data.timeControl))
      throw new ValidationError(
        'Invalid time control format. Use format: "minutes+increment"'
      );

    // Don't spin up a duplicate casual game against someone you already have an
    // unfinished game with — continue the existing one instead. (Tournament
    // games are paired by the tournament and excluded.)
    if (!data.tournamentId) {
      const existing = await this.gameRepository.findOpenBetween(
        data.whiteId,
        data.blackId
      );
      if (existing) return existing;
    }

    return this.gameRepository.create(data);
  }

  async getGameById(id: string) {
    const game = await this.gameRepository.findById(id);
    if (!game) throw new NotFoundError("Game not found");
    return game;
  }

  async getGames(filters?: GameFilters) {
    return this.gameRepository.findMany(filters);
  }

  async getUserGames(userId: string, status?: GameStatus) {
    return this.gameRepository.findUserGames(userId, status);
  }

  async getActiveGames() {
    return this.gameRepository.findActiveGames();
  }

  async makeMove(data: MakeMoveDTO) {
    const game = await this.getGameById(data.gameId);

    if (game.status !== GameStatus.ACTIVE && game.status !== GameStatus.PENDING)
      throw new ValidationError("Game is not active");

    const moves = game.moves ? game.moves.split(" ").filter(Boolean) : [];
    const isWhiteTurn = moves.length % 2 === 0;

    if (isWhiteTurn && data.userId !== game.whiteId)
      throw new AuthorizationError("Not white's turn");
    if (!isWhiteTurn && data.userId !== game.blackId)
      throw new AuthorizationError("Not black's turn");

    const updatedMoves = game.moves ? `${game.moves} ${data.move}` : data.move;
    const newStatus =
      game.status === GameStatus.PENDING ? GameStatus.ACTIVE : game.status;

    return this.gameRepository.update(data.gameId, {
      moves: updatedMoves,
      status: newStatus,
    });
  }

  async resignGame(gameId: string, userId: string) {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.ACTIVE && game.status !== GameStatus.PENDING)
      throw new ValidationError("Game is not active");

    if (userId !== game.whiteId && userId !== game.blackId)
      throw new AuthorizationError("Only players can resign");

    const result =
      userId === game.whiteId ? GameResult.BLACK_WIN : GameResult.WHITE_WIN;

    const updatedGame = await this.gameRepository.update(gameId, {
      status: GameStatus.COMPLETED,
      result,
    });

    await this.updateRatingsAfterGame(updatedGame);

    return updatedGame;
  }

  /** Cancel a game that never got going (a pending invite). Marks it ABANDONED
   *  so it leaves the lists and no longer blocks a fresh pairing. */
  async cancelGame(gameId: string, userId: string) {
    const game = await this.getGameById(gameId);

    if (userId !== game.whiteId && userId !== game.blackId)
      throw new AuthorizationError("Only players can cancel this game");

    if (game.status !== GameStatus.PENDING)
      throw new ValidationError("Only a pending game can be cancelled");

    return this.gameRepository.update(gameId, { status: GameStatus.ABANDONED });
  }

  async endGame(gameId: string, result: GameResult) {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.ACTIVE)
      throw new ValidationError("Game is not active");

    const updatedGame = await this.gameRepository.update(gameId, {
      status: GameStatus.COMPLETED,
      result,
    });

    await this.updateRatingsAfterGame(updatedGame);

    return updatedGame;
  }

  private async updateRatingsAfterGame(game: {
    result: GameResult | null;
    whiteId: string;
    blackId: string;
    white: { rating: number };
    black: { rating: number };
  }) {
    if (!game.result) return;

    const whiteScore =
      game.result === GameResult.WHITE_WIN
        ? 1
        : game.result === GameResult.DRAW
          ? 0.5
          : 0;
    const blackScore =
      game.result === GameResult.BLACK_WIN
        ? 1
        : game.result === GameResult.DRAW
          ? 0.5
          : 0;

    const whiteNewRating = this.userService.calculateEloRating(
      game.white.rating,
      game.black.rating,
      whiteScore
    );
    const blackNewRating = this.userService.calculateEloRating(
      game.black.rating,
      game.white.rating,
      blackScore
    );

    await Promise.all([
      this.userService.updateUserRating(game.whiteId, whiteNewRating),
      this.userService.updateUserRating(game.blackId, blackNewRating),
    ]);
  }

  /** Award XP for a completed game once per player. Returns xpAwarded (0 if already awarded). */
  async recordGameCompleted(
    gameId: string,
    userId: string
  ): Promise<{ xpAwarded: number }> {
    const game = await this.gameRepository.findById(gameId);
    if (!game) throw new NotFoundError("Game not found");
    if (game.status !== GameStatus.COMPLETED)
      throw new ValidationError("Game is not completed");
    if (userId !== game.whiteId && userId !== game.blackId)
      throw new AuthorizationError("You are not a participant in this game");

    const existing = await this.prisma.gameXpAward.findUnique({
      where: { gameId_userId: { gameId, userId } },
    });
    if (existing) return { xpAwarded: 0 };

    const isWhite = userId === game.whiteId;
    const xp =
      !game.result
        ? XP_DRAW
        : (game.result === GameResult.WHITE_WIN && isWhite) ||
            (game.result === GameResult.BLACK_WIN && !isWhite)
          ? XP_WIN
          : XP_LOSS;

    const profile = await this.prisma.profile.findFirst({
      where: { userId },
    });
    if (profile) {
      await this.prisma.$transaction([
        this.prisma.profile.update({
          where: { id: profile.id },
          data: { xp: profile.xp + xp },
        }),
        this.prisma.gameXpAward.create({
          data: { gameId, userId },
        }),
      ]);
    } else {
      await this.prisma.gameXpAward.create({
        data: { gameId, userId },
      });
    }
    return { xpAwarded: xp };
  }

  /**
   * Finalize a live game whose outcome was decided on the gameplay server (cca):
   * persist status/result/moves and apply Glicko-2 rating changes. Idempotent —
   * an already-finished game is returned unchanged (no double rating). A null
   * `result` means the game was aborted (voided): marked ABANDONED, no rating.
   */
  async recordGameResult(params: {
    gameId: string;
    userId: string;
    result: GameResult | null;
    reason?: string | null;
    moves?: string | null;
  }) {
    const game = await this.getGameById(params.gameId);

    if (params.userId !== game.whiteId && params.userId !== game.blackId)
      throw new AuthorizationError("You are not a participant in this game");

    if (
      game.status === GameStatus.COMPLETED ||
      game.status === GameStatus.ABANDONED
    )
      return game;

    if (params.result == null) {
      return this.gameRepository.update(params.gameId, {
        status: GameStatus.ABANDONED,
        ...(params.moves != null ? { moves: params.moves } : {}),
      });
    }

    const updated = await this.gameRepository.update(params.gameId, {
      status: GameStatus.COMPLETED,
      result: params.result,
      ...(params.moves != null ? { moves: params.moves } : {}),
    });

    // Isolated so a not-yet-migrated player_ratings table degrades gracefully:
    // the result still persists; ratings catch up once the migration is applied.
    try {
      await this.applyGlickoRatings(updated);
    } catch (err) {
      console.error("[recordGameResult] rating update skipped:", err);
    }

    return updated;
  }

  private async applyGlickoRatings(game: {
    result: GameResult | null;
    rated?: boolean;
    whiteId: string;
    blackId: string;
    white: { rating: number };
    black: { rating: number };
  }) {
    if (!game.result) return;
    if (game.rated === false) return; // casual game — outcome recorded, ratings untouched

    const whiteState = await this.getOrInitRating(game.whiteId, game.white.rating);
    const blackState = await this.getOrInitRating(game.blackId, game.black.rating);

    const whiteScore =
      game.result === GameResult.WHITE_WIN
        ? 1
        : game.result === GameResult.BLACK_WIN
          ? 0
          : 0.5;
    const blackScore = 1 - whiteScore;

    // Both updates use the opponent's PRE-game state.
    const whiteNew = glicko2Update(whiteState, blackState, whiteScore);
    const blackNew = glicko2Update(blackState, whiteState, blackScore);

    await this.prisma.$transaction([
      this.upsertRating(game.whiteId, whiteNew),
      this.upsertRating(game.blackId, blackNew),
      this.prisma.user.update({
        where: { id: game.whiteId },
        data: { rating: toDisplayRating(whiteNew.rating) },
      }),
      this.prisma.user.update({
        where: { id: game.blackId },
        data: { rating: toDisplayRating(blackNew.rating) },
      }),
    ]);
  }

  private async getOrInitRating(userId: string, fallbackRating: number) {
    const row = await this.prisma.playerRating.findUnique({ where: { userId } });
    if (row) return { rating: row.rating, rd: row.deviation, vol: row.volatility };
    return { rating: fallbackRating, rd: DEFAULT_RD, vol: DEFAULT_VOL };
  }

  private upsertRating(
    userId: string,
    state: { rating: number; rd: number; vol: number }
  ) {
    return this.prisma.playerRating.upsert({
      where: { userId },
      create: {
        userId,
        rating: state.rating,
        deviation: state.rd,
        volatility: state.vol,
      },
      update: {
        rating: state.rating,
        deviation: state.rd,
        volatility: state.vol,
      },
    });
  }
}
